import { chmod, copyFile, mkdir, readdir, rm } from "node:fs/promises";
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

function isLfsPointer(path: string): boolean {
  if (!existsSync(path) || statSync(path).size >= 1000) return false;
  return readFileSync(path, "utf8").startsWith(
    "version https://git-lfs.github.com/spec/v1",
  );
}

const projectVendorDir = join(import.meta.dir, "..", "vendor");
const configuredToolsDir = process.env.TOOLS_DIR?.trim();
const configuredYtdlpPath = process.env.YTDLP_PATH?.trim();
const projectYtdlp = join(projectVendorDir, "yt-dlp");
const projectFfmpeg = join(projectVendorDir, "ffmpeg");
const projectFfprobe = join(projectVendorDir, "ffprobe");
const needsRuntimeTools =
  !configuredToolsDir &&
  !configuredYtdlpPath &&
  (isLfsPointer(projectYtdlp) ||
    isLfsPointer(projectFfmpeg) ||
    isLfsPointer(projectFfprobe) ||
    !existsSync(projectYtdlp) ||
    !existsSync(projectFfmpeg) ||
    !existsSync(projectFfprobe));
const toolsDir = configuredToolsDir ||
  (needsRuntimeTools ? join(import.meta.dir, "..", ".runtime-tools") : projectVendorDir);
const bundledYtDlp = configuredYtdlpPath || join(toolsDir, "yt-dlp");
const bundledFfmpeg = join(toolsDir, "ffmpeg");
const bundledFfprobe = join(toolsDir, "ffprobe");

async function findFile(root: string, filename: string): Promise<string | undefined> {
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isFile() && entry.name === filename) return path;
    if (entry.isDirectory()) {
      const found = await findFile(path, filename);
      if (found) return found;
    }
  }
  return undefined;
}

async function downloadFile(url: string, destination: string): Promise<void> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`تعذر تنزيل ${url}: HTTP ${response.status}`);
  }
  await Bun.write(destination, await response.arrayBuffer());
  await chmod(destination, 0o755);
}

async function ensureBundledTools(): Promise<void> {
  await mkdir(toolsDir, { recursive: true });

  if (!existsSync(bundledYtDlp) || isLfsPointer(bundledYtDlp)) {
    console.log("جاري تنزيل yt-dlp Linux x86_64...");
    await downloadFile(
      "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux",
      bundledYtDlp,
    );
  }

  if (!existsSync(bundledFfmpeg) || isLfsPointer(bundledFfmpeg) ||
      !existsSync(bundledFfprobe) || isLfsPointer(bundledFfprobe)) {
    console.log("جاري تنزيل FFmpeg Linux x86_64...");
    const archive = join(toolsDir, ".ffmpeg-linux64.tar.xz");
    const extractDir = join(toolsDir, ".ffmpeg-extract");
    await downloadFile(
      "https://github.com/FFmpeg-Builds/FFmpeg-Builds/releases/download/latest/ffmpeg-n9.0-latest-linux64-gpl-9.0.tar.xz",
      archive,
    );
    await rm(extractDir, { recursive: true, force: true });
    await mkdir(extractDir, { recursive: true });
    const extraction = Bun.spawn(["tar", "-xJf", archive, "-C", extractDir], {
      stdout: "ignore",
      stderr: "pipe",
    });
    const extractionError = await new Response(extraction.stderr).text();
    if ((await extraction.exited) !== 0) {
      throw new Error(`تعذر فك حزمة FFmpeg: ${extractionError}`);
    }
    const ffmpegSource = await findFile(extractDir, "ffmpeg");
    const ffprobeSource = await findFile(extractDir, "ffprobe");
    if (!ffmpegSource || !ffprobeSource) {
      throw new Error("لم يتم العثور على ffmpeg أو ffprobe داخل الحزمة المنزّلة.");
    }
    await copyFile(ffmpegSource, bundledFfmpeg);
    await copyFile(ffprobeSource, bundledFfprobe);
    await chmod(bundledFfmpeg, 0o755);
    await chmod(bundledFfprobe, 0o755);
    await rm(archive, { force: true });
    await rm(extractDir, { recursive: true, force: true });
  }
}

await ensureBundledTools();

if (!existsSync(bundledYtDlp) || isLfsPointer(bundledYtDlp)) {
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

process.env.PATH = `${toolsDir}:${process.env.PATH ?? ""}`;

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
