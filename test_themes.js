const puppeteer = require('puppeteer');

const THEMES = ['default', 'space', 'aero', 'cyberpunk', 'scourge', 'angelic', '8space', 'castingcasings'];

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
        await new Promise(r => setTimeout(r, 400));
        await page.screenshot({ path: `/home/claude/work/screenshots/theme_${theme}_menu.png` });
    }

    console.log('Errors:', errs);
    await browser.close();
})();
