const https = require('https');
https.get('https://market-api.pmnd.rs/models', (resp) => {
    let data = '';
    resp.on('data', (chunk) => data += chunk);
    resp.on('end', () => {
        try {
            const models = JSON.parse(data);
            const trees = models.filter(m => m.title.toLowerCase().includes('tree') || m.title.toLowerCase().includes('grass'));
            trees.forEach(t => console.log(t.title, t.gltf));
        } catch (e) { console.error(e) }
    });
}).on("error", (err) => {
    console.log("Error: " + err.message);
});
