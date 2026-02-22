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
