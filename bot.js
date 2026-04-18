const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } = require("@whiskeysockets/baileys");
const { Boom } = require("@hapi/boom");
const QRCode = require("qrcode");
const express = require("express");
const fs = require("fs");

// ✅ Express server
const app = express();
let lastQR = "";

app.get("/", (req, res) => res.send("Doctor Bot is running ✅"));
app.get("/qr", async (req, res) => {
    if (!lastQR) return res.send("<h2>QR not ready — Bot already connected OR wait 10 seconds and refresh</h2>");
    const qrImage = await QRCode.toDataURL(lastQR);
    res.send(`<html><body style="display:flex;justify-content:center;align-items:center;height:100vh;background:#111">
        <img src="${qrImage}" style="width:300px;height:300px"/>
        </body></html>`);
});
app.listen(process.env.PORT || 3000, () => console.log("✅ Express server running"));

/* ================= SETTINGS ================= */

const SUPERADMIN_PHONES = [
    "919699430407",
    "190030962278465"
];

const ADMIN_PIN = "1234";

let userState = {};
let tokenCounter = {};
let appointments = {};
let adminLoggedInUsers = {};
let dynamicAdmins = ["918268242769"];
let pendingAdmins = {};
let userLang = {};

let dailyLimit = 50;
let clinicOpen = true;
let closedDays = [];
let closedDates = [];

const triggerWords = [
    "appointment", "book", "doctor", "checkup", "token", "milna", "dikhana",
    "अपॉइंटमेंट", "बुक", "डॉक्टर", "टोकन"
];

const msg = {
    hi: {
        selectLang:  "भाषा चुनें:\n1️⃣ हिंदी के लिए *hindi* लिखें\n2️⃣ English के लिए *english* लिखें",
        welcome:     "नमस्ते 🙏\nअपना नाम लिखिए",
        askPhone:    "अपना मोबाइल नंबर लिखिए",
        askDate:     "अपॉइंटमेंट की तारीख लिखिए (उदाहरण: 12 April)",
        confirmed:   (token) => `अपॉइंटमेंट कन्फर्म हो गया ✅\nआपका टोकन नंबर: *${token}*\n\nदोबारा अपॉइंटमेंट लेने के लिए *appointment* लिखें`,
        full:        "आज के लिए अपॉइंटमेंट भर चुके हैं ❌",
        closed:      "क्लिनिक आज बंद है ❌",
        closedDay:   (d) => `क्लिनिक ${d} को बंद है ❌`,
        closedDate:  (d) => `क्लिनिक ${d} को बंद है ❌`,
    },
    en: {
        selectLang:  "Choose language:\n1️⃣ Type *hindi* for हिंदी\n2️⃣ Type *english* for English",
        welcome:     "Hello 🙏\nPlease enter your name",
        askPhone:    "Please enter your mobile number",
        askDate:     "Please enter appointment date (example: 12 April)",
        confirmed:   (token) => `Appointment confirmed ✅\nYour token number: *${token}*\n\nTo book again, type *appointment*`,
        full:        "No appointments available for today ❌",
        closed:      "Clinic is closed today ❌",
        closedDay:   (d) => `Clinic is closed on ${d} ❌`,
        closedDate:  (d) => `Clinic is closed on ${d} ❌`,
    }
};

function t(senderRaw, key, ...args) {
    const lang = userLang[senderRaw] || "hi";
    const val = msg[lang][key];
    return typeof val === "function" ? val(...args) : val;
}

function getPhoneNumber(jid) { return jid.replace(/@.+/, "").trim(); }
function checkIsSuperAdmin(sender) { return SUPERADMIN_PHONES.some(s => sender.includes(s) || s.includes(sender)); }
function checkIsAdmin(sender) { if (checkIsSuperAdmin(sender)) return true; return dynamicAdmins.some(a => sender.includes(a) || a.includes(sender)); }
function isTriggerWord(text) { return triggerWords.includes(text); }

function cleanOldAppointments() {
    const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
    Object.keys(appointments).forEach(key => { if (appointments[key].timestamp < sevenDaysAgo) delete appointments[key]; });
}

function parseDate(str) {
    const months = {
        jan: "january", feb: "february", mar: "march", apr: "april",
        may: "may", jun: "june", jul: "july", aug: "august",
        sep: "september", oct: "october", nov: "november", dec: "december",
        january: "january", february: "february", march: "march", april: "april",
        june: "june", july: "july", august: "august", september: "september",
        october: "october", november: "november", december: "december"
    };
    const parts = str.toLowerCase().trim().split(" ");
    if (parts.length < 2) return null;
    const day = parts[0];
    const month = months[parts[1]];
    if (!month) return null;
    return `${day} ${month}`;
}

async function startBot() {
    const { state, saveCreds } = await useMultiFileAuthState("auth_info");
    const { version } = await fetchLatestBaileysVersion();

    const sock = makeWASocket({
        version,
        auth: state,
        printQRInTerminal: true,
        browser: ["Doctor Bot", "Chrome", "1.0.0"],
    });

    sock.ev.on("creds.update", saveCreds);

    sock.ev.on("connection.update", async ({ connection, lastDisconnect, qr }) => {
        if (qr) {
            lastQR = qr;
            console.log("✅ QR ready — open /qr URL to scan");
        }
        if (connection === "close") {
            lastQR = "";
            const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
            console.log("Connection closed — reconnecting:", shouldReconnect);
            if (shouldReconnect) startBot();
        }
        if (connection === "open") {
            lastQR = "";
            console.log("✅ WhatsApp Bot Connected!");
        }
    });

    async function sendMessage(jid, text) {
        await sock.sendMessage(jid, { text });
    }

    async function notifySuperAdmin(text) {
        for (const phone of SUPERADMIN_PHONES) {
            try { await sendMessage(phone + "@s.whatsapp.net", text); } catch (e) {}
        }
    }

    sock.ev.on("messages.upsert", async ({ messages }) => {
        const message = messages[0];
        if (!message?.message) return;
        if (message.key.fromMe) return;

        const from = message.key.remoteJid;
        if (from.endsWith("@g.us")) return;

        const senderRaw = from;
        const sender = getPhoneNumber(from);
        const text = (message.message?.conversation || message.message?.extendedTextMessage?.text || "").toLowerCase().trim();

        if (!text) return;

        const isSuperAdmin = checkIsSuperAdmin(sender);
        const isAdmin = checkIsAdmin(sender);
        const isLoggedIn = adminLoggedInUsers[sender];

        cleanOldAppointments();

        const reply = (txt) => sendMessage(from, txt);

        // ===================== JOIN ADMIN =====================
        if (text === "join admin") {
            if (checkIsAdmin(sender)) return reply("Aap pehle se admin hain ✅");
            pendingAdmins[sender] = true;
            await notifySuperAdmin(`🔔 *New Admin Request*\nNumber: ${sender}\n\nApprove:\napprove ${sender}\n\nReject:\ndisapprove ${sender}`);
            return reply("Aapki admin request bhej di gayi hai ✅\nSuperadmin ke approve karne ka intezaar karein 🙏");
        }

        // ===================== LOGIN =====================
        if (isAdmin && text.startsWith("login")) {
            const pin = text.split(" ")[1];
            if (pin === ADMIN_PIN) {
                adminLoggedInUsers[sender] = true;
                let commands = `Admin login successful ✅\n\n📋 *Commands:*\n*list* — aaj ki appointments\n*list full* — aaj + future sab\n*list 12 april* — us din ki appointments\n*history* — last 7 din\n*limit 30* — daily limit change\n*close sunday* — din band\n*close 12 april* — date band\n*open sunday* — din kholo\n*open* — clinic kholo\n*close* — clinic band\n*delete [phone]* — appointment delete\n*delete old* — 7 din purane delete\n*reset* — sab reset`;
                if (isSuperAdmin) commands += "\n\n👑 *Superadmin Commands:*\napprove [number]\ndisapprove [number]\npending\nadmin add [number]\nadmin remove [number]\nadmin list";
                return reply(commands);
            }
            return reply("Wrong PIN ❌");
        }

        // ===================== SUPERADMIN COMMANDS =====================
        if (isSuperAdmin && isLoggedIn) {
            if (text.startsWith("approve ")) {
                const num = text.replace("approve ", "").trim();
                if (!pendingAdmins[num]) return reply(`${num} ki koi pending request nahi hai`);
                dynamicAdmins.push(num);
                delete pendingAdmins[num];
                try { await sendMessage(num + "@s.whatsapp.net", "🎉 Aapki admin request approve ho gayi!\nAb *login 1234* likh ke admin panel use karein."); } catch (e) {}
                return reply(`${num} ko admin bana diya gaya ✅`);
            }
            if (text.startsWith("disapprove ")) {
                const num = text.replace("disapprove ", "").trim();
                delete pendingAdmins[num];
                try { await sendMessage(num + "@s.whatsapp.net", "❌ Aapki admin request reject kar di gayi."); } catch (e) {}
                return reply(`${num} ki request reject kar di gayi ❌`);
            }
            if (text === "pending") {
                const list = Object.keys(pendingAdmins);
                if (!list.length) return reply("Koi pending request nahi hai");
                return reply("⏳ Pending Requests:\n\n" + list.map(n => `• ${n}`).join("\n"));
            }
            if (text.startsWith("admin add ")) {
                const newAdmin = text.replace("admin add ", "").trim();
                if (dynamicAdmins.includes(newAdmin)) return reply(`${newAdmin} already admin hai ✅`);
                dynamicAdmins.push(newAdmin);
                return reply(`${newAdmin} ko admin bana diya gaya ✅`);
            }
            if (text.startsWith("admin remove ")) {
                const removeAdmin = text.replace("admin remove ", "").trim();
                dynamicAdmins = dynamicAdmins.filter(a => a !== removeAdmin);
                adminLoggedInUsers[removeAdmin] = false;
                return reply(`${removeAdmin} ko admin se hata diya gaya ✅`);
            }
            if (text === "admin list") {
                let replyText = "👑 Superadmins (fixed):\n";
                SUPERADMIN_PHONES.forEach(s => replyText += `• ${s}\n`);
                replyText += "\n👤 Admins:\n";
                replyText += dynamicAdmins.length ? dynamicAdmins.map(a => `• ${a}`).join("\n") : "Koi admin nahi hai";
                return reply(replyText);
            }
        }

        // ===================== ADMIN COMMANDS =====================
        if (isAdmin && isLoggedIn) {
            if (text === "list") {
                const todayStr = new Date().toLocaleDateString("en-US", { day: "numeric", month: "long" }).toLowerCase();
                const todayList = Object.values(appointments).filter(a => a.date === todayStr);
                if (!todayList.length) return reply(`Aaj (${todayStr}) ki koi appointment nahi hai`);
                let r = `📋 *Aaj ki Appointments (${todayStr}):*\n\n`;
                todayList.sort((a, b) => a.token - b.token).forEach(a => { r += `Token: *${a.token}*\nName: ${a.name}\nPhone: ${a.phone}\n\n`; });
                return reply(r);
            }
            if (text === "list full") {
                const today = new Date(); today.setHours(0,0,0,0);
                const futureList = Object.values(appointments).filter(a => {
                    const d = new Date(a.date + " " + new Date().getFullYear());
                    return d >= today;
                });
                if (!futureList.length) return reply("Koi upcoming appointment nahi hai");
                const grouped = {};
                futureList.forEach(a => { if (!grouped[a.date]) grouped[a.date] = []; grouped[a.date].push(a); });
                let r = "📋 *Aaj + Future Appointments:*\n\n";
                Object.keys(grouped).sort().forEach(date => {
                    r += `━━━ ${date} ━━━\n`;
                    grouped[date].sort((a, b) => a.token - b.token).forEach(a => { r += `Token *${a.token}*: ${a.name} (${a.phone})\n`; });
                    r += "\n";
                });
                return reply(r);
            }
            if (text.startsWith("list ")) {
                const dateStr = parseDate(text.replace("list ", "").trim());
                if (!dateStr) return reply("❌ Date galat hai\nExample: list 12 april");
                const dayList = Object.values(appointments).filter(a => a.date === dateStr);
                if (!dayList.length) return reply(`${dateStr} ki koi appointment nahi hai`);
                let r = `📋 *${dateStr} ki Appointments:*\n\n`;
                dayList.sort((a, b) => a.token - b.token).forEach(a => { r += `Token: *${a.token}*\nName: ${a.name}\nPhone: ${a.phone}\n\n`; });
                return reply(r);
            }
            if (text === "history") {
                if (!Object.keys(appointments).length) return reply("Koi appointment nahi mili (7 din mein)");
                const grouped = {};
                Object.values(appointments).forEach(a => { if (!grouped[a.date]) grouped[a.date] = []; grouped[a.date].push(a); });
                let r = "📅 *Last 7 Days:*\n\n";
                Object.keys(grouped).sort().forEach(date => {
                    r += `━━━ ${date} ━━━\n`;
                    grouped[date].sort((a, b) => a.token - b.token).forEach(a => { r += `Token ${a.token}: ${a.name} (${a.phone})\n`; });
                    r += "\n";
                });
                return reply(r);
            }
            if (text === "delete old") {
                const before = Object.keys(appointments).length;
                cleanOldAppointments();
                const after = Object.keys(appointments).length;
                return reply(`${before - after} purani appointments delete ho gayi ✅`);
            }
            if (text.startsWith("delete ")) {
                const phone = text.replace("delete ", "").trim();
                const keys = Object.keys(appointments).filter(k => k.startsWith(phone));
                if (!keys.length) return reply(`${phone} ki koi appointment nahi mili ❌`);
                keys.forEach(k => delete appointments[k]);
                return reply(`${phone} ki appointment(s) delete ho gayi ✅`);
            }
            if (text === "reset") { tokenCounter = {}; appointments = {}; return reply("Tokens reset successfully ✅"); }
            if (text.startsWith("limit")) {
                const newLimit = parseInt(text.split(" ")[1]);
                if (!newLimit) return reply("Invalid number");
                dailyLimit = newLimit;
                return reply(`Daily limit set to ${dailyLimit} ✅`);
            }
            if (text.startsWith("close ")) {
                const value = text.replace("close ", "").trim();
                if (value.match(/[0-9]/)) { closedDates.push(value); return reply(`${value} closed ❌`); }
                closedDays.push(value);
                return reply(`${value} closed ❌`);
            }
            if (text.startsWith("open ")) {
                const value = text.replace("open ", "").trim();
                closedDays = closedDays.filter(d => d !== value);
                closedDates = closedDates.filter(d => d !== value);
                return reply(`${value} opened ✅`);
            }
            if (text === "close") { clinicOpen = false; return reply("Clinic closed ❌"); }
            if (text === "open") { clinicOpen = true; return reply("Clinic open ✅"); }
            return;
        }

        // ===================== USER FLOW =====================
        if (!clinicOpen) return reply(t(senderRaw, "closed"));

        const today = new Date();
        const todayDay = today.toLocaleDateString("en-US", { weekday: "long" }).toLowerCase();
        const todayDate = today.toLocaleDateString("en-US", { day: "numeric", month: "long" }).toLowerCase();

        if (closedDays.includes(todayDay)) return reply(t(senderRaw, "closedDay", todayDay));
        if (closedDates.includes(todayDate)) return reply(t(senderRaw, "closedDate", todayDate));

        if (userState[senderRaw] && userState[senderRaw].step === 0) {
            if (text === 'hindi') { userLang[senderRaw] = 'hi'; userState[senderRaw] = { step: 1 }; return reply(msg.hi.welcome); }
            if (text === 'english') { userLang[senderRaw] = 'en'; userState[senderRaw] = { step: 1 }; return reply(msg.en.welcome); }
            return reply(msg.hi.selectLang);
        }

        if (userState[senderRaw] && userState[senderRaw].step >= 1) {
            if (userState[senderRaw].step === 1) {
                userState[senderRaw].name = message.message?.conversation || message.message?.extendedTextMessage?.text || "";
                userState[senderRaw].step = 2;
                return reply(t(senderRaw, 'askPhone'));
            }
            if (userState[senderRaw].step === 2) {
                userState[senderRaw].phone = message.message?.conversation || message.message?.extendedTextMessage?.text || "";
                userState[senderRaw].step = 3;
                return reply(t(senderRaw, 'askDate'));
            }
            if (userState[senderRaw].step === 3) {
                const requestedDate = (message.message?.conversation || message.message?.extendedTextMessage?.text || "").trim().toLowerCase();
                const parsedDate = parseDate(requestedDate);
                const saveDate = parsedDate || new Date().toLocaleDateString('en-US', { day: 'numeric', month: 'long' }).toLowerCase();

                if (!tokenCounter[saveDate]) tokenCounter[saveDate] = 1;
                if (tokenCounter[saveDate] > dailyLimit) {
                    delete userState[senderRaw];
                    delete userLang[senderRaw];
                    return reply(t(senderRaw, 'full'));
                }
                const token = tokenCounter[saveDate]++;
                appointments[userState[senderRaw].phone + '_' + Date.now()] = {
                    name: userState[senderRaw].name,
                    phone: userState[senderRaw].phone,
                    date: saveDate,
                    token,
                    timestamp: Date.now()
                };
                delete userState[senderRaw];
                delete userLang[senderRaw];
                return reply(t(senderRaw, 'confirmed', token));
            }
            return;
        }

        if (isTriggerWord(text)) { userState[senderRaw] = { step: 0 }; return reply(msg.hi.selectLang); }
    });
}

startBot();
