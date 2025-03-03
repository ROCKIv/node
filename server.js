const express = require('express');
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const cors = require('cors');
const app = express();

puppeteer.use(StealthPlugin());

const port = process.env.PORT || 3000;

app.use(express.json({ limit: '1mb' })); // Limitar tamaño del cuerpo de la solicitud
app.use(cors({ origin: '*' })); // Simplificar CORS

// Endpoint POST /track
app.post('/track', async (req, res) => {
    const { trackingNumber } = req.body;

    if (!trackingNumber || typeof trackingNumber !== 'string') {
        return res.status(400).json({ error: 'Valid tracking number is required' });
    }

    try {
        const data = await scrape17track(trackingNumber.trim());
        res.json(data);
    } catch (error) {
        res.status(500).json({ error: 'Tracking failed' });
    }
});

// Función optimizada para scraping
async function scrape17track(trackingNumber) {
    const browser = await puppeteer.launch({
        headless: 'new', // Usar nuevo modo headless más eficiente
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-accelerated-2d-canvas',
            '--no-first-run',
            '--no-zygote',
            '--single-process', // Reducir procesos
            '--disable-gpu',
            '--disable-extensions',
            '--disable-background-networking',
            '--disable-sync',
            '--disable-translate',
            '--disable-background-timer-throttling',
            '--disable-client-side-phishing-detection',
            '--disable-default-apps',
            '--no-default-browser-check',
            '--mute-audio'
        ],
        executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined, // Usar binario preinstalado si está disponible
        defaultViewport: { width: 1280, height: 800 } // Reducir resolución
    });

    try {
        const page = await browser.newPage();
        await page.setRequestInterception(true); // Interceptar solicitudes
        page.on('request', (req) => {
            const resourceType = req.resourceType();
            // Bloquear recursos innecesarios
            if (['image', 'media', 'font', 'stylesheet'].includes(resourceType)) {
                req.abort();
            } else {
                req.continue();
            }
        });

        await page.setCacheEnabled(false); // Desactivar caché
        const url = `https://t.17track.net/es#nums=${trackingNumber}`;
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 }); // Reducir timeout y esperar menos

        // Esperar solo lo esencial
        await Promise.race([
            page.waitForSelector('.track-container, .tracklist-item', { timeout: 30000 }),
            page.waitForTimeout(5000) // Fallback si no carga rápidamente
        ]);

        const data = await page.evaluate(() => {
            const courier = document.querySelector('.provider-name')?.textContent.trim() || 'Unknown';
            const status = document.querySelector('.text-capitalize[title]')?.textContent.trim() ||
                           document.querySelector('.trn-block dd:first-child p')?.textContent.trim() || 'No info';
            const events = Array.from(document.querySelectorAll('.trn-block dd')).slice(0, 5).map(event => { // Limitar eventos
                const date = event.querySelector('time')?.textContent.trim() || 'No date';
                const description = event.querySelector('p')?.textContent.trim() || 'No description';
                const locationMatch = description.match(/【(.+?)】/) || description.match(/^(.+?),/);
                const location = locationMatch ? locationMatch[1] || locationMatch[0].replace(/,$/, '') : 'No location';
                return { date, location, description };
            });
            return { courier, status, events };
        });

        await page.close(); // Cerrar página inmediatamente
        return data;

    } finally {
        await browser.close(); // Asegurar cierre del navegador
    }
}

// Health check
app.get('/health', (req, res) => res.send('OK'));

app.listen(port, () => console.log(`Backend running on port ${port}`));