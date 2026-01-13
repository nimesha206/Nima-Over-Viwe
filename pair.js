import express from 'express';
import fs from 'fs';
import pino from 'pino';
import { makeWASocket, useMultiFileAuthState, delay, makeCacheableSignalKeyStore, Browsers, jidNormalizedUser, fetchLatestBaileysVersion } from '@whiskeysockets/baileys';
import pn from 'awesome-phonenumber';

const router = express.Router();

// Ensure the session directory exists
function removeFile(FilePath) {
    try {
        if (!fs.existsSync(FilePath)) return false;
        fs.rmSync(FilePath, { recursive: true, force: true });
    } catch (e) {
        console.error('Error removing file:', e);
    }
}

router.get('/', async (req, res) => {
    let num = req.query.number;
    let dirs = './' + (num || `session`);

    // Remove existing session if present
    await removeFile(dirs);

    // Clean the phone number - remove any non-digit characters
    num = num.replace(/[^0-9]/g, '');

    // Validate the phone number using awesome-phonenumber
    const phone = pn('+' + num);
    if (!phone.isValid()) {
        if (!res.headersSent) {
            return res.status(400).send({ code: 'වැරදි දුරකථන අංකයකි. නැවත පරීක්ෂා කරන්න (උදාහරණ., US 94726800969 , UK 447911123456, Vietnam 84987654321, .) හිස්තැන් හෝ + ලකුණ දැමීමෙන් වළකින්න.' });
        }
        return;
    }
    // Use the international number format (E.164, without '+')
    num = phone.getNumber('e164').replace('+', '');

    async function initiateSession() {
        const { state, saveCreds } = await useMultiFileAuthState(dirs);

        try {
            const { version, isLatest } = await fetchLatestBaileysVersion();
            let nimaBot = makeWASocket({
                version,
                auth: {
                    creds: state.creds,
                    keys: makeCacheableSignalKeyStore(state.keys, pino({ level: "fatal" }).child({ level: "fatal" })),
                },
                printQRInTerminal: false,
                logger: pino({ level: "fatal" }).child({ level: "fatal" }),
                browser: Browsers.windows('Chrome'),
                markOnlineOnConnect: false,
                generateHighQualityLinkPreview: false,
                defaultQueryTimeoutMs: 60000,
                connectTimeoutMs: 60000,
                keepAliveIntervalMs: 30000,
                retryRequestDelayMs: 250,
                maxRetries: 5,
            });

            nimaBot.ev.on('connection.update', async (update) => {
                const { connection, lastDisconnect, isNewLogin, isOnline } = update;

                if (connection === 'open') {
                    console.log("✅ සාර්ථකව සම්බන්ධ උණි!");
                    console.log("📱 පරිශීලකයාට session file එක යවමින්...");
                    
                    try {
                        const sessionnima = fs.readFileSync(dirs + '/creds.json');

                        // Send session file to user
                        const userJid = jidNormalizedUser(num + '@s.whatsapp.net');
                        await nimaBot.sendMessage(userJid, {
                            document: sessionnima,
                            mimetype: 'application/json',
                            fileName: 'creds.json'
                        });
                        console.log("📄 Session file යැවීම සාර්ථකයි");

                        // Send video thumbnail with caption
                        await nimaBot.sendMessage(userJid, {
                            image: { url: 'https://img.youtube.com/vi/-oz_u1iMgf8/maxresdefault.jpg' },
                            caption: `🎬 *NIMA බොට් සම්බන්ධ කිරීම සාර්ථකයි!*\n\n🚀 Bug නිවැරදි කර ඇත + නවතම විධාන + ඉක්මන් AI Chat\n📺 Whatsapp සම්බන්ධ වන්න "+94726800969"`
                        });
                        console.log("🎬 වීඩියෝ ලින්කුව යැවීම සාර්ථකයි");

                        // Send warning message
                        await nimaBot.sendMessage(userJid, {
                            text: `⚠️මෙය කිසිවෙකුට යවන්න එපා⚠️\n 
┌┤✑  ඉස්තූතියි NIMA බොට් සම්බන්ධ කරාට
│└────────────┈ ⳹        
│©CREATED BY NIMESHA
└─────────────────┈ ⳹\n\n`
                        });
                        console.log("⚠️ අවදානයට යවන පණිවිඩය යැවීම සාර්ථකයි");

                        // Clean up session after use
                        console.log("🧹 session ඉවත් කරමින්...");
                        await delay(1000);
                        removeFile(dirs);
                        console.log("✅ Session ඉවත් කිරීම සාර්ථකයි");
                        console.log("🎉 සෑදීම සාර්ථකයි!");
                        // Do not exit the process, just finish gracefully
                    } catch (error) {
                        console.error("❌ පණිවිඩය යැවීම අසාර්ථකයි:", error);
                        // Still clean up session even if sending fails
                        removeFile(dirs);
                        // Do not exit the process, just finish gracefully
                    }
                }

                if (isNewLogin) {
                    console.log("🔐 අලුතින් සම්බන්ධ වීමේ pair code");
                }

                if (isOnline) {
                    console.log("📶 nima බොට් ඔන්ලයින්");
                }

                if (connection === 'close') {
                    const statusCode = lastDisconnect?.error?.output?.statusCode;

                    if (statusCode === 401) {
                        console.log("❌ whatsapp වලින් ඉවත් කෙරිණි. නවැත සම්බන්ධ කරන්න.");
                    } else {
                        console.log("🔁 සම්බන්ධ තාවය මග හැරුණි. නැවත පනගන්වමින්...");
                        initiateSession();
                    }
                }
            });

            if (!nimaBot.authState.creds.registered) {
                await delay(3000); // Wait 3 seconds before requesting pairing code
                num = num.replace(/[^\d+]/g, '');
                if (num.startsWith('+')) num = num.substring(1);

                try {
                    let code = await nimaBot.requestPairingCode(num);
                    code = code?.match(/.{1,4}/g)?.join('-') || code;
                    if (!res.headersSent) {
                        console.log({ num, code });
                        await res.send({ code });
                    }
                } catch (error) {
                    console.error('pair code ඉල්ලීම අසාර්ථකයි:', error);
                    if (!res.headersSent) {
                        res.status(503).send({ code: 'pair code ගැනීම අසාර්ථකයි. දුරකථන අංකය පරීක්ෂා කරන්න.' });
                    }
                }
            }

            nimaBot.ev.on('creds.update', saveCreds);
        } catch (err) {
            console.error('session බාගැනීම අසාර්ථකයි:', err);
            if (!res.headersSent) {
                res.status(503).send({ code: 'Service Unavailable' });
            }
        }
    }

    await initiateSession();
});

// Global uncaught exception handler
process.on('uncaughtException', (err) => {
    let e = String(err);
    if (e.includes("conflict")) return;
    if (e.includes("not-authorized")) return;
    if (e.includes("Socket connection timeout")) return;
    if (e.includes("rate-overlimit")) return;
    if (e.includes("Connection Closed")) return;
    if (e.includes("Timed Out")) return;
    if (e.includes("Value not found")) return;
    if (e.includes("Stream Errored")) return;
    if (e.includes("Stream Errored (restart required)")) return;
    if (e.includes("statusCode: 515")) return;
    if (e.includes("statusCode: 503")) return;
    console.log('Caught exception: ', err);
});

export default router;