// main.js - Main entry point for the application to ensure correct script loading order.

async function initializeApp() {
    try {
        // 1. Load environment variables first.
        // The 'load-env.js' script uses top-level await, so this import will not
        // resolve until window.env is populated or an error occurs.
        await import('./load-env.js');
        console.log("Environment loader has finished.");

        // 2. Load the main application logic.
        await import('./app.js');
        console.log("Main application script has been loaded.");

    } catch (error) {
        console.error("A critical error occurred during application initialization:", error);
        // Optionally, display a user-friendly error message on the page
        document.body.innerHTML = '<div style="text-align: center; padding: 2rem; font-family: sans-serif;"><h1>Error Aplikasi</h1><p>Gagal memuat aplikasi. Silakan coba lagi nanti.</p></div>';
    }
}

initializeApp();