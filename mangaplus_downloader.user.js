// ==UserScript==
// @name         MangaPlus Chapter Downloader & Decryptor
// @namespace    https://github.com/toannguyen3105/mangaplus-downloader
// @version      23.0
// @description  Tự động nạp, giải mã XOR và tải trọn bộ chương truyện MangaPlus (Đảm bảo nút luôn xuất hiện ngay lập tức lần đầu vào trang qua MutationObserver)
// @author       toannh8
// @match        https://mangaplus.shueisha.co.jp/*
// @run-at       document-start
// @grant        none
// ==/UserScript==

(function () {
    'use strict';

    const inpageApp = function () {
        const CONFIG = {
            VERSION: 'v23.0',
            SCROLL_INTERVAL_MS: 70,
            SCROLL_STEP_PX: 450,
            CDN_LIBS: {
                JSZip: 'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js',
                saveAs: 'https://cdnjs.cloudflare.com/ajax/libs/FileSaver.js/2.0.5/FileSaver.min.js'
            }
        };

        let currentChapterId = getChapterIdFromUrl(window.location.href);

        const state = {
            images: new Map(),
            keys: new Map(),
            expectedTotalPages: 0,
            isProcessing: false,
            isCompleted: false,
            autoTriggered: false,
            ui: { container: null, button: null }
        };

        function getChapterIdFromUrl(url) {
            const m = (url || '').match(/\/viewer\/(\d+)/);
            return m ? m[1] : null;
        }

        function resetChapterState(newChapterId) {
            currentChapterId = newChapterId;
            state.images.clear();
            state.keys.clear();
            state.expectedTotalPages = 0;
            state.isProcessing = false;
            state.isCompleted = false;
            state.autoTriggered = false;
            updateUI();
        }

        function monitorUrlChanges() {
            let lastUrl = window.location.href;

            const checkUrl = () => {
                const currentUrl = window.location.href;
                if (currentUrl !== lastUrl) {
                    lastUrl = currentUrl;
                    const newId = getChapterIdFromUrl(currentUrl);
                    if (newId && newId !== currentChapterId) {
                        resetChapterState(newId);
                    }
                }
                ensureUIExists();
            };

            const origPushState = history.pushState;
            const origReplaceState = history.replaceState;

            history.pushState = function (...args) {
                const ret = origPushState.apply(this, args);
                checkUrl();
                return ret;
            };

            history.replaceState = function (...args) {
                const ret = origReplaceState.apply(this, args);
                checkUrl();
                return ret;
            };

            window.addEventListener('popstate', checkUrl);
            setInterval(checkUrl, 400);
        }

        // 1. DEPENDENCIES
        function loadExternalScript(url) {
            return new Promise((resolve, reject) => {
                const script = document.createElement('script');
                script.src = url;
                script.onload = resolve;
                script.onerror = reject;
                (document.head || document.documentElement).appendChild(script);
            });
        }

        async function ensureDependencies() {
            if (!window.JSZip) {
                await loadExternalScript(CONFIG.CDN_LIBS.JSZip);
            }
            if (!window.saveAs) {
                await loadExternalScript(CONFIG.CDN_LIBS.saveAs);
            }
        }

        function sanitizeFilename(name) {
            return (name || 'MangaPlus_Chapter')
                .replace(/[\\/:*?"<>|]/g, '_')
                .replace(/\s+/g, ' ')
                .trim();
        }

        // 2. IMAGE DECRYPTION
        function decryptMangaPage(rawBytes, hexKey) {
            if (rawBytes.length >= 3 && rawBytes[0] === 0xFF && rawBytes[1] === 0xD8 && rawBytes[2] === 0xFF) {
                return rawBytes;
            }

            if (hexKey && hexKey.length >= 2) {
                const keyLen = hexKey.length / 2;
                const keyBytes = new Uint8Array(keyLen);
                for (let i = 0; i < keyLen; i++) {
                    keyBytes[i] = parseInt(hexKey.substr(i * 2, 2), 16);
                }

                const decrypted = new Uint8Array(rawBytes.length);
                for (let i = 0; i < rawBytes.length; i++) {
                    decrypted[i] = rawBytes[i] ^ keyBytes[i % keyLen];
                }

                if (decrypted.length >= 3 && decrypted[0] === 0xFF && decrypted[1] === 0xD8 && decrypted[2] === 0xFF) {
                    return decrypted;
                }
            }

            return rawBytes;
        }

        function extractPageNumber(url) {
            if (!url) return null;

            // Pattern 1: /manga_page/.../0.jpg, /1.jpg
            let m = url.match(/\/manga_page\/(?:high|super_high|mid|low|raw)?\/(\d+)\.jpg/i);
            if (m) {
                const num = parseInt(m[1], 10);
                if (num >= 0 && num < 500) return num;
            }

            // Pattern 2: /chapter/.../page/0.jpg
            m = url.match(/\/chapter\/\d+\/(?:manga_page|page)\/(\d+)\.jpg/i);
            if (m) {
                const num = parseInt(m[1], 10);
                if (num >= 0 && num < 500) return num;
            }

            // Pattern 3: /page/0.jpg or /p/0.jpg
            m = url.match(/\/(?:page|p)\/(\d+)\.jpg/i);
            if (m) {
                const num = parseInt(m[1], 10);
                if (num >= 0 && num < 500) return num;
            }

            // Pattern 4: Tên file dạng số nhỏ kết thúc bằng .jpg (ví dụ /001.jpg, /15.jpg) nhưng KHÔNG phải ID dài như /11990588.jpg
            m = url.match(/\/0*([1-9]\d{0,2})\.jpg(?:\?|$)/i);
            if (m) {
                const num = parseInt(m[1], 10);
                if (num > 0 && num < 300) return num;
            }

            return null;
        }

        // 3. NETWORK HOOK
        function setupNetworkInterception() {
            const originalOpen = XMLHttpRequest.prototype.open;
            const originalSend = XMLHttpRequest.prototype.send;

            XMLHttpRequest.prototype.open = function (method, url, ...rest) {
                this._interceptedUrl = typeof url === 'string' ? url : '';
                return originalOpen.apply(this, [method, url, ...rest]);
            };

            XMLHttpRequest.prototype.send = function (...args) {
                this.addEventListener('load', function () {
                    if (!this._interceptedUrl || this.status !== 200) return;

                    if (this._interceptedUrl.includes('manga_viewer') || this._interceptedUrl.includes('viewer')) {
                        try {
                            const reqChapId = getChapterIdFromUrl(this._interceptedUrl);
                            if (reqChapId && reqChapId !== currentChapterId) {
                                resetChapterState(reqChapId);
                            }

                            if (this.response instanceof ArrayBuffer) {
                                parseViewerProtobuf(new Uint8Array(this.response));
                            } else if (typeof this.responseText === 'string') {
                                const enc = new TextEncoder();
                                parseViewerProtobuf(enc.encode(this.responseText));
                            }
                        } catch (err) {}
                    }

                    if (this._interceptedUrl.includes('manga_page') || this._interceptedUrl.includes('/chapter/')) {
                        const pageNum = extractPageNumber(this._interceptedUrl);
                        if (pageNum !== null && this.response instanceof ArrayBuffer && this.response.byteLength > 5000) {
                            state.images.set(pageNum, new Uint8Array(this.response));
                            updateUI();
                        }
                    }
                });

                return originalSend.apply(this, args);
            };
        }

        function parseViewerProtobuf(bytes) {
            let latin1String = '';
            for (let i = 0; i < bytes.length; i++) {
                latin1String += String.fromCharCode(bytes[i]);
            }

            const urlPattern = /(https:\/\/[a-zA-Z0-9.\-_]+\/(?:secure|drm)\/[a-zA-Z0-9_\-\.\/\?=&%]+\.jpg[a-zA-Z0-9_\-\.\/\?=&%]*)/g;
            let match;
            let maxPageNum = 0;
            let pageCount = 0;

            while ((match = urlPattern.exec(latin1String)) !== null) {
                const url = match[1];
                // Loại bỏ tuyệt đối các banner quảng cáo, thumbnail truyện, icon, avatar
                if (url.includes('banner') || url.includes('thumbnail') || url.includes('icon') || url.includes('title_avatar')) continue;
                // Chỉ nhận các url thực sự là manga_page hoặc page của viewer
                if (!url.includes('manga_page') && !url.includes('/chapter/') && !url.includes('/page/')) continue;

                pageCount++;
                const pageNum = extractPageNumber(url) || pageCount;
                if (pageNum < 300 && pageNum > maxPageNum) maxPageNum = pageNum;

                const lookaheadArea = latin1String.substr(match.index + url.length, 140);
                const hexMatch = lookaheadArea.match(/([a-f0-9]{32})/);
                if (hexMatch) {
                    state.keys.set(pageNum, hexMatch[1]);
                }
            }

            if (maxPageNum > 0 && maxPageNum < 300) {
                state.expectedTotalPages = maxPageNum;
            } else if (pageCount > 0 && pageCount < 300) {
                state.expectedTotalPages = pageCount;
            }

            updateUI();

            const isAuto = window.location.search.includes('auto=1') || window.name.includes('auto_runner');
            if (!state.autoTriggered && isAuto) {
                state.autoTriggered = true;
                setTimeout(() => handleDownloadFlow(), 1200);
            }
        }

        // 4. AUTO SCROLLER
        function getScrollTargets() {
            const targets = [window, document.documentElement, document.body];
            document.querySelectorAll('div, section, main').forEach((el) => {
                if (el.scrollHeight > el.clientHeight + 100) {
                    targets.push(el);
                }
            });
            return targets;
        }

        async function scrollThroughAllPages() {
            const scrollTargets = getScrollTargets();

            window.scrollTo({ top: 0, behavior: 'instant' });
            scrollTargets.forEach((el) => { if (el !== window) el.scrollTop = 0; });
            await new Promise((resolve) => setTimeout(resolve, 250));

            let lastCollected = 0;
            let idleIterations = 0;
            let iteration = 0;

            while (true) {
                iteration++;
                const expected = state.expectedTotalPages > 0 ? `/${state.expectedTotalPages}` : '';
                updateUI(`[${CONFIG.VERSION}] 🔄 Đang nạp: ${state.images.size}${expected} trang...`);

                scrollTargets.forEach((target) => {
                    try {
                        if (target === window) {
                            window.scrollBy({ top: CONFIG.SCROLL_STEP_PX, behavior: 'instant' });
                        } else {
                            target.scrollTop += CONFIG.SCROLL_STEP_PX;
                        }
                    } catch (e) { }
                });

                window.dispatchEvent(new Event('scroll'));
                window.dispatchEvent(new KeyboardEvent('keydown', { key: 'PageDown', keyCode: 34, bubbles: true }));
                document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', keyCode: 40, bubbles: true }));

                await new Promise((resolve) => setTimeout(resolve, CONFIG.SCROLL_INTERVAL_MS));

                if (state.expectedTotalPages > 0 && state.images.size >= state.expectedTotalPages) {
                    break;
                }

                if (state.images.size === lastCollected) {
                    idleIterations++;
                    if (idleIterations > 25 && state.images.size >= 10) break;
                } else {
                    idleIterations = 0;
                    lastCollected = state.images.size;
                }

                if (iteration > 300) break;
            }

            await new Promise((resolve) => setTimeout(resolve, 800));
        }

        // 5. ZIP PACKAGING
        async function handleDownloadFlow() {
            if (state.isProcessing) return;
            state.isProcessing = true;

            try {
                await ensureDependencies();

                if (state.expectedTotalPages === 0 || state.images.size < state.expectedTotalPages) {
                    await scrollThroughAllPages();
                }

                const totalPages = state.images.size;
                if (totalPages === 0) {
                    alert(`[${CONFIG.VERSION}] Chưa thu thập được trang nào. Hãy thử F5 tải lại trang!`);
                    state.isProcessing = false;
                    updateUI();
                    return;
                }

                updateUI(`[${CONFIG.VERSION}] 📦 Đang nén file ZIP (${totalPages} trang)...`);

                const chapterTitle = sanitizeFilename(document.title);
                const zip = new window.JSZip();
                const folder = zip.folder(chapterTitle);

                const sortedPageNumbers = Array.from(state.images.keys()).sort((a, b) => a - b);

                for (const pageNum of sortedPageNumbers) {
                    const rawBytes = state.images.get(pageNum);
                    const hexKey = state.keys.get(pageNum) || '';
                    const decryptedBytes = decryptMangaPage(rawBytes, hexKey);

                    const filename = `${String(pageNum).padStart(3, '0')}.jpg`;
                    folder.file(filename, decryptedBytes);
                }

                const zipBlob = await zip.generateAsync({ type: 'blob' });
                window.saveAs(zipBlob, `${chapterTitle}.zip`);

                state.isCompleted = true;
                updateUI(`[${CONFIG.VERSION}] ✓ Đã tải xong ${totalPages} trang!`);

                setTimeout(() => {
                    state.isProcessing = false;
                    updateUI();
                }, 4000);
            } catch (err) {
                console.error('[MangaPlus] Lỗi tải file:', err);
                alert(`[${CONFIG.VERSION}] Có lỗi xảy ra khi tải. Chi tiết tại Console F12.`);
                state.isProcessing = false;
                updateUI();
            }
        }

        // 6. UI CREATION & REMOVAL
        function ensureUIExists() {
            const isViewerPage = window.location.href.includes('/viewer/');
            const existingRoot = document.getElementById('mp-downloader-root');

            // Nếu KHÔNG PHẢI trang đọc truyện (/viewer/), lập tức xóa nút đi nếu đang tồn tại
            if (!isViewerPage) {
                if (existingRoot) {
                    existingRoot.remove();
                    state.ui.container = null;
                    state.ui.button = null;
                }
                return;
            }

            // Đang ở trang viewer: Nếu đã có nút thì không tạo lại
            if (existingRoot) return;

            const targetParent = document.body || document.documentElement;
            if (!targetParent) return;

            const container = document.createElement('div');
            container.id = 'mp-downloader-root';
            container.style.cssText = `
                position: fixed !important;
                bottom: 24px !important;
                right: 24px !important;
                z-index: 2147483647 !important;
                font-family: system-ui, -apple-system, sans-serif !important;
                display: flex !important;
                align-items: center !important;
                pointer-events: auto !important;
            `;

            const button = document.createElement('button');
            button.id = 'mp-download-btn';
            button.style.cssText = `
                padding: 13px 26px !important;
                background-color: #1b5e20 !important;
                color: #ffffff !important;
                border: 2px solid #ffffff !important;
                border-radius: 30px !important;
                cursor: pointer !important;
                font-weight: bold !important;
                font-size: 14px !important;
                box-shadow: 0 4px 18px rgba(0,0,0,0.45) !important;
                transition: all 0.25s ease !important;
                outline: none !important;
                user-select: none !important;
                display: block !important;
            `;

            button.onmouseenter = () => { button.style.transform = 'scale(1.03)'; };
            button.onmouseleave = () => { button.style.transform = 'scale(1)'; };
            button.onclick = handleDownloadFlow;

            container.appendChild(button);
            targetParent.appendChild(container);

            state.ui.container = container;
            state.ui.button = button;

            updateUI();
        }

        function updateUI(customText = null) {
            ensureUIExists();
            if (!state.ui.button) return;

            if (customText) {
                state.ui.button.innerText = customText;
                return;
            }

            if (state.isProcessing) return;

            const collectedCount = state.images.size;
            const expectedCount = state.expectedTotalPages;

            if (collectedCount > 0) {
                const pageInfo = expectedCount > 0 ? `${collectedCount}/${expectedCount}` : `${collectedCount}`;
                state.ui.button.innerText = `[${CONFIG.VERSION}] 📥 Tải trọn bộ (${pageInfo} trang - ZIP)`;
                state.ui.button.style.backgroundColor = '#1b5e20';
            } else {
                const expectedInfo = expectedCount > 0 ? ` (${expectedCount} trang)` : '';
                state.ui.button.innerText = `[${CONFIG.VERSION}] 📥 Tải trọn bộ chương MangaPlus${expectedInfo} (ZIP)`;
                state.ui.button.style.backgroundColor = '#0288d1';
            }
        }

        // Lắng nghe liên tục DOM mutation để nút xuất hiện/biến mất linh hoạt theo từng trang
        const observer = new MutationObserver(() => {
            ensureUIExists();
        });
        observer.observe(document.documentElement, { childList: true, subtree: true });

        setupNetworkInterception();
        monitorUrlChanges();
        ensureUIExists();
    };

    // Tiêm script vào DOM
    const scriptElement = document.createElement('script');
    scriptElement.textContent = `(${inpageApp.toString()})();`;
    (document.head || document.documentElement).appendChild(scriptElement);
    scriptElement.remove();
})();
