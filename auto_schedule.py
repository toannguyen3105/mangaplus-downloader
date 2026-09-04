import subprocess
import time
import os
import sys
import glob
import shutil

PROJECT_DIR = os.path.dirname(os.path.abspath(__file__))
DOWNLOAD_DIR = os.path.expanduser("~/Downloads")

WATCH_LIST = [
    "https://mangaplus.shueisha.co.jp/viewer/1000486"
]

def run_auto_download(chapter_url, timeout=45):
    print(f"\n=======================================================")
    print(f"⏰ [LỊCH TẢI TỰ ĐỘNG] Đang xử lý: {chapter_url}")
    print(f"=======================================================")

    # Dùng query ?auto=1 (KHÔNG DÙNG #auto để tránh bị MangaPlus redirect nhầm)
    sep = "&" if "?" in chapter_url else "?"
    clean_url = chapter_url.replace("#auto", "")
    target_url = clean_url if "auto=1" in clean_url else f"{clean_url}{sep}auto=1"

    before_files = set(glob.glob(os.path.join(DOWNLOAD_DIR, "*.zip")))

    cmd = ["google-chrome", "--new-window", target_url]
    proc = subprocess.Popen(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

    start_t = time.time()
    downloaded_zip = None

    print("⏳ Đang chờ trình duyệt tự động nạp, giải mã và lưu ZIP...")

    while time.time() - start_t < timeout:
        time.sleep(1.5)
        after_files = set(glob.glob(os.path.join(DOWNLOAD_DIR, "*.zip")))
        diff = after_files - before_files
        valid = [f for f in diff if not f.endswith('.crdownload') and os.path.getsize(f) > 50000]
        if valid:
            downloaded_zip = valid[0]
            break

    proc.terminate()
    try:
        proc.wait(timeout=2)
    except Exception:
        proc.kill()

    if downloaded_zip:
        dest = os.path.join(PROJECT_DIR, os.path.basename(downloaded_zip))
        shutil.move(downloaded_zip, dest)
        print(f"🎉 HOÀN THÀNH TỰ ĐỘNG 100%!")
        print(f"📂 File đã được chuyển vào Project: {dest}\n")
        return dest
    else:
        print("⚠️ Hết thời gian chờ mà chưa thấy file ZIP mới.")
        return None

def main():
    urls = sys.argv[1:] if len(sys.argv) > 1 else WATCH_LIST
    for url in urls:
        run_auto_download(url)

if __name__ == "__main__":
    main()
