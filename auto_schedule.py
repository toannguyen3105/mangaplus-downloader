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
    print(f"⏰ [AUTO SCHEDULE] Processing download for: {chapter_url}")
    print(f"=======================================================")

    # Use ?auto=1 query (avoid #auto hash to prevent MangaPlus router redirection)
    sep = "&" if "?" in chapter_url else "?"
    clean_url = chapter_url.replace("#auto", "")
    target_url = clean_url if "auto=1" in clean_url else f"{clean_url}{sep}auto=1"

    before_files = set(glob.glob(os.path.join(DOWNLOAD_DIR, "*.zip")))

    # Launch Chrome browser window
    cmd = ["google-chrome", "--new-window", target_url]
    proc = subprocess.Popen(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

    start_t = time.time()
    downloaded_zip = None

    print("⏳ Waiting for browser to load pages, descramble XOR, and export ZIP...")

    while time.time() - start_t < timeout:
        time.sleep(1.5)
        after_files = set(glob.glob(os.path.join(DOWNLOAD_DIR, "*.zip")))
        diff = after_files - before_files
        valid = [f for f in diff if not f.endswith('.crdownload') and os.path.getsize(f) > 50000]
        if valid:
            downloaded_zip = valid[0]
            break

    # Terminate browser process after download completes
    proc.terminate()
    try:
        proc.wait(timeout=2)
    except Exception:
        proc.kill()

    if downloaded_zip:
        dest = os.path.join(PROJECT_DIR, os.path.basename(downloaded_zip))
        shutil.move(downloaded_zip, dest)
        print(f"🎉 100% AUTOMATED DOWNLOAD COMPLETE!")
        print(f"📂 File saved to Project directory: {dest}\n")
        return dest
    else:
        print("⚠️ Timeout reached without finding new completed ZIP file.")
        return None

def main():
    urls = sys.argv[1:] if len(sys.argv) > 1 else WATCH_LIST
    for url in urls:
        run_auto_download(url)

if __name__ == "__main__":
    main()
