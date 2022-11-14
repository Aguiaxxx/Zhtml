import { program } from 'commander'
import { app, BrowserWindow } from 'electron'

program
    .name('html2svg')
    .showHelpAfterError()
    .showSuggestionAfterError()
    .argument('<url>', 'URL to the web page to render')
    .option(
        '-f, --format <format>',
        'set the output format, should one of these values: svg, pdf',
        'svg',
    )
    .action(async (url, { format }) => {
        const mode = getMode(format)

        app.dock?.hide()
        app.commandLine.appendSwitch('headless')
        app.commandLine.appendSwitch('no-sandbox')
        app.commandLine.appendSwitch('disable-gpu')

        await app.whenReady()

        const page = new BrowserWindow({
            show: false,
            width: 1920,
            height: 1080,
            webPreferences: { sandbox: false },
        })

        try {
            await new Promise<void>((resolve, reject) =>
                Promise.resolve()
                    .then(async () => {
                        const timeout = setTimeout(() => {
                            page.webContents.off('did-finish-load', listener)

                            reject(new Error('timeout'))
                        }, 10_000)
                        const listener = () => {
                            clearTimeout(timeout)

                            resolve()
                        }

                        page.webContents.once('did-finish-load', listener)

                        await page.loadURL(url)
                    })
                    .catch(reject),
            )

            const result = await page.webContents.executeJavaScript(
                `
                    new Promise(resolve => {
                        const style = document.createElement('style')
                        const policy = trustedTypes.createPolicy('html2svg/scrollbar-css', { createHTML: x => x })

                        style.innerHTML = policy.createHTML(\`
                            body::-webkit-scrollbar, body::-webkit-scrollbar-track, body::-webkit-scrollbar-thumb {
                                display: none;
                            }
                        \`)

                        document.head.appendChild(style)
                        scrollTo({ top: document.body.scrollHeight })

                        requestAnimationFrame(() => {
                            scrollTo({ top: 0 })

                            setTimeout(() => {
                                requestAnimationFrame(resolve)
                            }, 1000)
                        })
                    }).then(() => getPageContentsAsSVG(${mode}, document.title))
                `,
            )

            await print(new Uint8Array(result))
        } finally {
            page.destroy()
        }
    })
    .parseAsync(process.argv, { from: 'electron' })
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error)

        process.exit(1)
    })

// Electron seems to drop lines if we send them too fast on slow streams like Docker..
async function print(output: Uint8Array) {
    const awfulBugSizeHeuristic = 1024

    for (let i = 0; i < output.length; i += awfulBugSizeHeuristic) {
        await new Promise<void>((resolve, reject) =>
            process.stdout.write(
                output.slice(i, i + awfulBugSizeHeuristic),
                (error) => (error ? reject(error) : resolve()),
            ),
        )
    }
}

function getMode(format: string) {
    switch (format) {
        case 'svg':
            return 0
        case 'pdf':
            return 1
        default:
            throw new Error(`Unsupported output format: ${format}`)
    }
}
