const puppeteer = require('puppeteer');

const THEMES = ['space', 'cyberpunk', '8space'];

(async () => {
    const browser = await puppeteer.launch({
        headless: 'new',
        executablePath: '/home/claude/.cache/puppeteer/chrome/linux-131.0.6778.204/chrome-linux64/chrome',
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--window-size=1400,900'],
    });
    const page = await browser.newPage();
    await page.setViewport({ width: 1400, height: 900 });
    const errs = [];
    page.on('pageerror', e => { if (!e.message.includes('supabase-js')) errs.push(e.message); });

    await page.evaluateOnNewDocument(() => localStorage.setItem('dr_intro_done', '1'));
    await page.goto('http://localhost:8080/index.html', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await new Promise(r => setTimeout(r, 1200));

    for (const theme of THEMES) {
        await page.evaluate((t) => { applyTheme(t); }, theme);
        await new Promise(r => setTimeout(r, 500));

        // Settings > Looks & Themes
        await page.evaluate(() => { toggle('menu-settings', true); switchSettingsTab('looks'); });
        await new Promise(r => setTimeout(r, 2800));
        await page.screenshot({ path: `/home/claude/work/screenshots/theme_${theme}_settings.png` });
        await page.evaluate(() => { toggle('menu-settings', false); });
        await new Promise(r => setTimeout(r, 800));

        // Shop
        await page.evaluate(() => {
            const btn = [...document.querySelectorAll('button,div')].find(b => b.querySelector?.('.mnb-label')?.textContent === 'Shop');
            btn?.click();
        });
        await new Promise(r => setTimeout(r, 2800));
        await page.screenshot({ path: `/home/claude/work/screenshots/theme_${theme}_shop.png` });
        await page.evaluate(() => { toggle('menu-shop', false); });
        await new Promise(r => setTimeout(r, 800));

        // Profile menu
        await page.evaluate(() => { openProfile(); });
        await new Promise(r => setTimeout(r, 2800));
        await page.screenshot({ path: `/home/claude/work/screenshots/theme_${theme}_profile.png` });
        await page.evaluate(() => { document.getElementById('auth-wall-close')?.click(); toggle('auth-wall', false); });
        await new Promise(r => setTimeout(r, 800));
    }

    console.log('Errors:', errs);
    await browser.close();
})();
