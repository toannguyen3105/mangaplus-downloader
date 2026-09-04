import subprocess
import time
import os
import sys
import glob
import shutil

PROJECT_DIR = os.path.dirname(os.path.abspath(__file__))
DOWNLOAD_DIR = os.path.expanduser("~/Downloads")

def run_auto_download(chapter_url, timeout=40):
    print(f"\n=======================================================")
    print(f"🚀 [AUTO RUNNER] Đang tải tự động: {chapter_url}")
    print(f"=======================================================")

    # Gắn query ?auto=1 để kích hoạt Userscript v22 tự động chạy không bị React Router redirect
    sep = "&" if "?" in chapter_url else "?"
    target_url = chapter_url if "auto=1" in chapter_url else f"{chapter_url}{sep}auto=1"

    before_files = set(glob.glob(os.path.join(DOWNLOAD_DIR, "*.zip")))

    # Mở Chrome với trang web
    cmd = ["google-chrome", "--new-window", target_url]
    proc = subprocess.Popen(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

    start_t = time.time()
    downloaded_zip = None

    print("⏳ Đang chờ trình duyệt tự động nạp, giải mã và nén ZIP...")

    while time.time() - start_t < timeout:
        time.sleep(1.5)
        after_files = set(glob.glob(os.path.join(DOWNLOAD_DIR, "*.zip")))
        diff = after_files - before_files
        valid = [f for f in diff if not f.endswith('.crdownload') and os.path.getsize(f) > 50000]
        if valid:
            downloaded_zip = valid[0]
            break

    # Đóng Chrome
    proc.terminate()
    try:
        proc.wait(timeout=2)
    except Exception:
        proc.kill()

    if downloaded_zip:
        dest = os.path.join(PROJECT_DIR, os.path.basename(downloaded_zip))
        shutil.move(downloaded_zip, dest)
        print(f"🎉 HOÀN THÀNH TỰ ĐỘNG 100%!")
        print(f"📂 File đã được lưu vào Project: {dest}\n")
        return dest
    else:
        print("⚠️ Hết thời gian chờ mà chưa thấy file ZIP mới.")
        return None

if __name__ == "__main__":
    url = sys.argv[1] if len(sys.argv) > 1 else "https://mangaplus.shueisha.co.jp/viewer/1000486"
    run_auto_download(url)
