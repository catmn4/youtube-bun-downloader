import { mkdir } from "node:fs/promises";
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { download } from "@blagoja/ts-dlp";

type YtDlpFormat = {
  height?: number | null;
  ext?: string;
  fps?: number | null;
  vcodec?: string;
  acodec?: string;
};

type YtDlpInfo = {
  formats?: YtDlpFormat[];
};

type Quality = {
  height: number;
  ext: string;
  fps: number | null;
  hasAudio: boolean;
};

if (process.platform !== "linux" || process.arch !== "x64") {
  console.error(
    `هذا الإصدار مخصص لـ Linux x86_64 فقط. النظام الحالي: ${process.platform}/${process.arch}`,
  );
  process.exit(1);
}

const vendorDir = process.env.TOOLS_DIR?.trim() || join(import.meta.dir, "..", "vendor");
const bundledYtDlp = process.env.YTDLP_PATH?.trim() || join(vendorDir, "yt-dlp");

if (!existsSync(bundledYtDlp)) {
  throw new Error(
    `لم يتم العثور على yt-dlp في: ${bundledYtDlp}. اضبط YTDLP_PATH أو TOOLS_DIR داخل .env.`,
  );
}

const fileHeader = statSync(bundledYtDlp).size < 1000
  ? readFileSync(bundledYtDlp, "utf8").slice(0, 80)
  : "";
if (fileHeader.startsWith("version https://git-lfs.github.com/spec/v1")) {
  throw new Error(
    `الملف ${bundledYtDlp} هو Git LFS pointer وليس الملف التنفيذي. نفّذ git lfs pull أو ارفع binary الحقيقي إلى الخادم.`,
  );
}

process.env.PATH = `${dirname(bundledYtDlp)}:${process.env.PATH ?? ""}`;

const url = process.env.YOUTUBE_URL?.trim();
const outputDir = process.env.OUTPUT_DIR?.trim() || "downloads";
const format = process.env.VIDEO_FORMAT?.trim() || "mp4";
const audio = process.env.AUDIO_CODEC?.trim() || "m4a";
const filename = process.env.FILENAME?.trim() || "%(title)s.%(ext)s";
const fpsValue = process.env.FPS?.trim();

function isYouTubeUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return [
      "youtube.com",
      "www.youtube.com",
      "m.youtube.com",
      "music.youtube.com",
      "youtu.be",
    ].includes(parsed.hostname);
  } catch {
    return false;
  }
}

async function getAvailableQualities(videoUrl: string): Promise<Quality[]> {
  const process = Bun.spawn(
    [bundledYtDlp, "--dump-single-json", "--no-playlist", videoUrl],
    { stdout: "pipe", stderr: "pipe" },
  );

  const [stdout, stderr] = await Promise.all([
    new Response(process.stdout).text(),
    new Response(process.stderr).text(),
  ]);
  const exitCode = await process.exited;

  if (exitCode !== 0) {
    throw new Error(stderr.trim() || `yt-dlp انتهى برمز الخطأ ${exitCode}`);
  }

  let info: YtDlpInfo;
  try {
    info = JSON.parse(stdout) as YtDlpInfo;
  } catch {
    throw new Error("تعذر قراءة بيانات الجودات التي أعادها yt-dlp.");
  }

  const qualityByHeight = new Map<number, Quality>();
  for (const item of info.formats ?? []) {
    if (
      typeof item.height !== "number" ||
      item.height <= 0 ||
      !item.vcodec ||
      item.vcodec === "none"
    ) {
      continue;
    }

    const current: Quality = {
      height: item.height,
      ext: item.ext || "غير معروف",
      fps: typeof item.fps === "number" ? item.fps : null,
      hasAudio: Boolean(item.acodec && item.acodec !== "none"),
    };

    const previous = qualityByHeight.get(current.height);
    if (!previous || (!previous.hasAudio && current.hasAudio)) {
      qualityByHeight.set(current.height, current);
    }
  }

  return [...qualityByHeight.values()].sort((a, b) => a.height - b.height);
}

if (!url) {
  console.error("خطأ: ضع رابط الفيديو في YOUTUBE_URL داخل ملف .env");
  process.exit(1);
}

if (!isYouTubeUrl(url)) {
  console.error("خطأ: YOUTUBE_URL يجب أن يكون رابطًا صالحًا من YouTube.");
  process.exit(1);
}

const fps = fpsValue === undefined ? undefined : Number(fpsValue);
if (fps !== undefined && (!Number.isInteger(fps) || fps <= 0)) {
  console.error("خطأ: FPS يجب أن يكون رقمًا صحيحًا موجبًا، مثل 30 أو 60.");
  process.exit(1);
}

try {
  console.log("جاري جلب الجودات المتاحة...\n");
  const qualities = await getAvailableQualities(url);

  if (qualities.length === 0) {
    throw new Error("لم يعثر yt-dlp على أي جودة فيديو قابلة للتنزيل.");
  }

  console.log("الجودات المتاحة:");
  for (const [index, quality] of qualities.entries()) {
    const audioLabel = quality.hasAudio ? "فيديو + صوت" : "فيديو فقط";
    const fpsLabel = quality.fps ? `، ${quality.fps} FPS` : "";
    console.log(
      `  ${index + 1}. ${quality.height}p (${quality.ext}${fpsLabel}، ${audioLabel})`,
    );
  }

  const selected = qualities[Math.floor(Math.random() * qualities.length)];
  if (!selected) throw new Error("تعذر اختيار جودة عشوائية.");

  console.log(`\nتم اختيار الجودة عشوائيًا: ${selected.height}p`);
  await mkdir(outputDir, { recursive: true });

  const builder = download(url)
    .resolution(`${selected.height}p`)
    .format(format)
    .audio(audio)
    .output(outputDir)
    .filename(filename);

  if (fps !== undefined) builder.fps(fps);

  await builder.run();
  console.log("اكتمل التحميل بنجاح.");
} catch (error) {
  console.error("فشل التحميل.");
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
