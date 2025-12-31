const esbuild = require('esbuild');

async function build() {
    const entryPoints = [
        'src/background.ts',
        'src/content.ts',
        'src/popup.ts',
        'src/options.ts'
    ];

    try {
        await esbuild.build({
            entryPoints,
            bundle: true,
            outdir: 'dist',
            minify: false, // Set to true for production
            sourcemap: true,
            target: ['chrome100'],
            format: 'esm', // Use ESM for Chrome Extension service workers
            platform: 'browser',
            define: {
                'process.env.NODE_ENV': '"development"'
            }
        });
        console.log('Build succeeded.');
    } catch (error) {
        console.error('Build failed:', error);
        process.exit(1);
    }
}

build();
