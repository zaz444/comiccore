/* =====================================================
   theme.js — ComicCore Theme Loader
   Put this file in your project folder.
   Add ONE line to the <head> of every HTML page:
   <script src="theme.js"></script>

   It runs instantly, before anything is visible,
   so there's no flash of the wrong theme.
   ===================================================== */

(function () {
    var savedTheme = localStorage.getItem('cc-theme') || 'dark';
    document.documentElement.setAttribute('data-theme', savedTheme);
})();

// ── Enhanced File Upload Utilities ────────────────────────
window.ComicCore = window.ComicCore || {};

ComicCore.FileUpload = {
    // Compress image before upload
    async compressImage(file, maxWidth = 1920, maxHeight = 1920, quality = 0.8) {
        return new Promise((resolve) => {
            const canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d');
            const img = new Image();

            img.onload = () => {
                // Calculate new dimensions
                let { width, height } = img;
                if (width > height) {
                    if (width > maxWidth) {
                        height = (height * maxWidth) / width;
                        width = maxWidth;
                    }
                } else {
                    if (height > maxHeight) {
                        width = (width * maxHeight) / height;
                        height = maxHeight;
                    }
                }

                canvas.width = width;
                canvas.height = height;
                ctx.drawImage(img, 0, 0, width, height);

                canvas.toBlob(resolve, 'image/jpeg', quality);
            };

            img.src = URL.createObjectURL(file);
        });
    },

    // Upload with progress tracking
    async uploadWithProgress(file, path, bucket = 'comics', onProgress) {
        const compressed = await this.compressImage(file);
        const fileName = `${Date.now()}-${Math.random().toString(36).slice(2)}.jpg`;

        return new Promise((resolve, reject) => {
            const xhr = new XMLHttpRequest();

            xhr.upload.addEventListener('progress', (e) => {
                if (e.lengthComputable && onProgress) {
                    onProgress(Math.round((e.loaded / e.total) * 100));
                }
            });

            xhr.addEventListener('load', () => {
                if (xhr.status === 200) {
                    resolve(JSON.parse(xhr.response));
                } else {
                    reject(new Error('Upload failed'));
                }
            });

            xhr.addEventListener('error', () => reject(new Error('Upload failed')));

            const formData = new FormData();
            formData.append('file', compressed);

            xhr.open('POST', `https://mmycqeejhguzhtzkyjaj.supabase.co/storage/v1/object/${bucket}/${path}/${fileName}`);
            xhr.setRequestHeader('Authorization', `Bearer ${supabase.supabaseKey}`);
            xhr.send(formData);
        });
    },

    // Create upload progress UI
    createProgressUI(container) {
        const progressContainer = document.createElement('div');
        progressContainer.className = 'upload-progress';
        progressContainer.innerHTML = `
            <div class="progress-bar">
                <div class="progress-fill"></div>
            </div>
            <div class="progress-text">Uploading...</div>
        `;
        container.appendChild(progressContainer);
        return progressContainer;
    },

    // Update progress UI
    updateProgress(ui, percent, text = 'Uploading...') {
        const fill = ui.querySelector('.progress-fill');
        const textEl = ui.querySelector('.progress-text');
        fill.style.width = `${percent}%`;
        textEl.textContent = `${text} ${percent}%`;
    },

    // Remove progress UI
    removeProgressUI(ui) {
        ui.remove();
    }
};

// ── Enhanced Toast System ────────────────────────────────
ComicCore.Toast = {
    show(message, type = 'info', duration = 3000) {
        const toast = document.createElement('div');
        toast.className = `toast toast-${type} animate-slide-in-right`;
        toast.innerHTML = `
            <span class="toast-icon">${this.getIcon(type)}</span>
            <span class="toast-message">${message}</span>
            <button class="toast-close" onclick="this.parentElement.remove()">×</button>
        `;

        const container = document.querySelector('.toast-container') || this.createContainer();
        container.appendChild(toast);

        setTimeout(() => {
            toast.classList.add('fade-out');
            setTimeout(() => toast.remove(), 300);
        }, duration);
    },

    getIcon(type) {
        const icons = {
            success: '✓',
            error: '✕',
            warning: '⚠',
            info: 'ℹ'
        };
        return icons[type] || icons.info;
    },

    createContainer() {
        const container = document.createElement('div');
        container.className = 'toast-container';
        document.body.appendChild(container);
        return container;
    }
};

// Add to window for global access
window.showToast = ComicCore.Toast.show.bind(ComicCore.Toast);
