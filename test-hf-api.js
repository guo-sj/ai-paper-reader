import fetch from 'node-fetch';
import { HttpsProxyAgent } from 'https-proxy-agent';
import { SocksProxyAgent } from 'socks-proxy-agent';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, '.env') });

const proxyUrl = process.env.HTTPS_PROXY || process.env.HTTP_PROXY;
const fetchOptions = {
    timeout: 30000,
};
if (proxyUrl) {
    console.log(`Using proxy: ${proxyUrl}`);
    // Support both HTTP/HTTPS and SOCKS5 proxies
    if (proxyUrl.startsWith('socks://') || proxyUrl.startsWith('socks5://') || proxyUrl.startsWith('socks4://')) {
        fetchOptions.agent = new SocksProxyAgent(proxyUrl);
    } else {
        fetchOptions.agent = new HttpsProxyAgent(proxyUrl);
    }
}

const url = 'https://huggingface.co/api/daily_papers';

try {
    console.log('Fetching from:', url);
    const response = await fetch(url, fetchOptions);
    if (!response.ok) throw new Error('Failed to fetch from HF');

    const data = await response.json();

    console.log('\n=== Total papers:', data.length);
    console.log('\n=== First 3 items structure:');
    console.log(JSON.stringify(data.slice(0, 3), null, 2));

    console.log('\n=== Available fields in first item:');
    if (data.length > 0) {
        console.log('Top level keys:', Object.keys(data[0]));
        console.log('Paper keys:', Object.keys(data[0].paper || {}));
    }

    console.log('\n=== First 10 papers with upvotes:');
    data.slice(0, 10).forEach((item, idx) => {
        console.log(`${idx + 1}. [${item.numHearts || 0} ❤️] ${item.paper.title}`);
    });

} catch (error) {
    console.error('Error:', error);
}
