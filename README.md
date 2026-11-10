# YouTube Bun Downloader

مشروع CLI باستخدام Bun و`@blagoja/ts-dlp` لتحميل فيديو من YouTube. ضع الرابط في ملف `.env` بدلًا من كتابته داخل الكود.

## المنصة المدعومة

هذه الحزمة مجهزة لأجهزة **Linux x86_64** فقط (`process.arch === "x64"`). سيتوقف البرنامج برسالة واضحة إذا شُغّل على ARM أو نظام تشغيل آخر.

تم تضمين الأدوات داخل مجلد `vendor/`:

- `yt-dlp` الإصدار `2026.10.26`
- `ffmpeg` و`ffprobe`، حزمة FFmpeg Linux64 GPL

ويضيف البرنامج مجلد الأدوات تلقائيًا إلى `PATH`، لذلك يستخدم الأدوات المضمّنة في جلب الجودات ودمج الفيديو والصوت.

## التشغيل على Wispbyte

في Wispbyte يكون مجلد المشروع عادة:

```text
/home/container
```

لذلك المسار المتوقع للملفات هو:

```text
/home/container/vendor/yt-dlp
/home/container/vendor/ffmpeg
/home/container/vendor/ffprobe
```

لا تضع `/home/ubuntu` في `.env`. إذا وضعت الأدوات في مكان مختلف، يمكنك تحديد المسار:

```env
TOOLS_DIR=/home/container/vendor
# أو تحديد yt-dlp مباشرة:
# YTDLP_PATH=/home/container/vendor/yt-dlp
```

إذا وجدت لوحة الاستضافة ملفات Git LFS pointer بدل binaries، فسيكتشف البرنامج ذلك وينزّل تلقائيًا نسخ Linux x86_64 الحقيقية إلى `.runtime-tools/` عند بدء التشغيل، ويترك ملفات Git LFS الأصلية دون تعديل حتى لا يتعارض `AUTO_UPDATE`. يحتاج الخادم إلى اتصال إنترنت، وقد يستغرق أول تشغيل عدة دقائق بسبب حجم FFmpeg.

## التشغيل

```bash
cp .env.example .env
# عدّل YOUTUBE_URL داخل .env
bun install
bun run start
```

عند التشغيل سيجلب البرنامج الجودات المتاحة من `yt-dlp`، يعرضها في الطرفية، ثم يختار واحدة عشوائيًا ويبدأ التنزيل. سيتم حفظ الملفات افتراضيًا داخل `downloads/`.

## الإعدادات

| المتغير | القيمة الافتراضية | الوصف |
|---|---:|---|
| `YOUTUBE_URL` | — | رابط فيديو YouTube، وهو مطلوب |
| `OUTPUT_DIR` | `downloads` | مجلد الحفظ |
| `VIDEO_FORMAT` | `mp4` | حاوية الفيديو |
| `AUDIO_CODEC` | `m4a` | تفضيل صيغة الصوت |
| `FPS` | — | حد اختياري لمعدل الإطارات، مثل `60` |
| `FILENAME` | `%(title)s.%(ext)s` | قالب اسم الملف بصيغة yt-dlp |
| `TOOLS_DIR` | `./vendor` | مجلد الأدوات المضمّنة |
| `YTDLP_PATH` | `./vendor/yt-dlp` | مسار yt-dlp المباشر |

## ملاحظات الترخيص

ملفات `yt-dlp` وFFmpeg مضمّنة من مصادرها الرسمية. نسخة FFmpeg المستخدمة مبنية بترخيص GPL؛ راجع `vendor/README.md` وشروط الترخيص قبل إعادة توزيع المشروع.

استخدم المشروع فقط للمحتوى الذي تملك حق تنزيله، والتزم بشروط YouTube والقوانين المحلية.
