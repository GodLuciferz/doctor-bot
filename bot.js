const { Client, LocalAuth } = require("whatsapp-web.js");
const qrcode = require("qrcode-terminal");
const puppeteer = require("puppeteer");

// Dynamic Chrome path — Render pe automatically sahi path milega
async function getChromePath() {
    try {
        const browser = await puppeteer.launch({ headless: true, args: ["--no-sandbox"] });
        const path = browser.process().spawnfile;
        await browser.close();
        return path;
    } catch (e) {
        console.log("Chrome auto-detect failed, using default:", e.message);
        return null;
    }
}

async function startBot() {

    const chromePath = await getChromePath();
    console.log("Chrome path detected:", chromePath);

    const client = new Client({
        authStrategy: new LocalAuth(),
        puppeteer: {
            headless: true,
            ...(chromePath && { executablePath: chromePath }),
            args: [
                "--no-sandbox",
                "--disable-setuid-sandbox",
                "--disable-dev-shm-usage",
                "--disable-accelerated-2d-canvas",
                "--no-first-run",
                "--no-zygote",
                "--single-process",
                "--disable-gpu"
            ]
        }
    });

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

client.on("qr", qr => { qrcode.generate(qr, { small: true }); });
client.on("ready", () => { console.log("WhatsApp Bot Ready ✅"); });

function getPhoneNumber(senderId) { return senderId.replace(/@.+/, "").trim(); }
function checkIsSuperAdmin(sender) { return SUPERADMIN_PHONES.some(s => sender.includes(s) || s.includes(sender)); }
function checkIsAdmin(sender) { if (checkIsSuperAdmin(sender)) return true; return dynamicAdmins.some(a => sender.includes(a) || a.includes(sender)); }
function isTriggerWord(text) { return triggerWords.includes(text); }

function cleanOldAppointments() {
    const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
    Object.keys(appointments).forEach(key => { if (appointments[key].timestamp < sevenDaysAgo) delete appointments[key]; });
}

async function notifySuperAdmin(text) {
    for (const phone of SUPERADMIN_PHONES) { try { await client.sendMessage(phone + "@c.us", text); } catch (e) {} }
}

client.on("message", async message => {
    if (message.from.endsWith("@g.us")) return;

    const senderRaw = message.from;
    const sender = getPhoneNumber(senderRaw);
    const text = message.body.toLowerCase().trim();

    const isSuperAdmin = checkIsSuperAdmin(sender);
    const isAdmin = checkIsAdmin(sender);
    const isLoggedIn = adminLoggedInUsers[sender];

    cleanOldAppointments();

    if (text === "join admin") {
        if (checkIsAdmin(sender)) return message.reply("Aap pehle se admin hain ✅");
        pendingAdmins[sender] = true;
        await notifySuperAdmin(`🔔 *New Admin Request*\nNumber: ${sender}\n\nApprove:\napprove ${sender}\n\nReject:\ndisapprove ${sender}`);
        return message.reply("Aapki admin request bhej di gayi hai ✅\nSuperadmin ke approve karne ka intezaar karein 🙏");
    }

    if (isAdmin && text.startsWith("login")) {
        const pin = text.split(" ")[1];
        if (pin === ADMIN_PIN) {
            adminLoggedInUsers[sender] = true;
            let commands = "Admin login successful ✅\n\nCommands:\nlist\nhistory\nlimit 30\nclose sunday\nclose 12 april\nopen sunday\nopen\nclose\nreset";
            if (isSuperAdmin) commands += "\n\n👑 Superadmin Commands:\napprove [number]\ndisapprove [number]\npending\nadmin add [number]\nadmin remove [number]\nadmin list";
            return message.reply(commands);
        }
        return message.reply("Wrong PIN ❌");
    }

    if (isSuperAdmin && isLoggedIn) {
        if (text.startsWith("approve ")) {
            const num = text.replace("approve ", "").trim();
            if (!pendingAdmins[num]) return message.reply(`${num} ki koi pending request nahi hai`);
            dynamicAdmins.push(num);
            delete pendingAdmins[num];
            try { await client.sendMessage(num + "@c.us", "🎉 Aapki admin request approve ho gayi!\nAb *login 1234* likh ke admin panel use karein."); } catch (e) {}
            return message.reply(`${num} ko admin bana diya gaya ✅`);
        }
        if (text.startsWith("disapprove ")) {
            const num = text.replace("disapprove ", "").trim();
            delete pendingAdmins[num];
            try { await client.sendMessage(num + "@c.us", "❌ Aapki admin request reject kar di gayi."); } catch (e) {}
            return message.reply(`${num} ki request reject kar di gayi ❌`);
        }
        if (text === "pending") {
            const list = Object.keys(pendingAdmins);
            if (!list.length) return message.reply("Koi pending request nahi hai");
            return message.reply("⏳ Pending Requests:\n\n" + list.map(n => `• ${n}`).join("\n"));
        }
        if (text.startsWith("admin add ")) {
            const newAdmin = text.replace("admin add ", "").trim();
            if (dynamicAdmins.includes(newAdmin)) return message.reply(`${newAdmin} already admin hai ✅`);
            dynamicAdmins.push(newAdmin);
            return message.reply(`${newAdmin} ko admin bana diya gaya ✅`);
        }
        if (text.startsWith("admin remove ")) {
            const removeAdmin = text.replace("admin remove ", "").trim();
            dynamicAdmins = dynamicAdmins.filter(a => a !== removeAdmin);
            adminLoggedInUsers[removeAdmin] = false;
            return message.reply(`${removeAdmin} ko admin se hata diya gaya ✅`);
        }
        if (text === "admin list") {
            let reply = "👑 Superadmins (fixed):\n";
            SUPERADMIN_PHONES.forEach(s => reply += `• ${s}\n`);
            reply += "\n👤 Admins:\n";
            reply += dynamicAdmins.length ? dynamicAdmins.map(a => `• ${a}`).join("\n") : "Koi admin nahi hai";
            return message.reply(reply);
        }
    }

    if (isAdmin && isLoggedIn) {
        if (text === "list") {
            const todayStr = new Date().toLocaleDateString("en-US", { day: "numeric", month: "long" }).toLowerCase();
            const todayList = Object.values(appointments).filter(a => a.date === todayStr);
            if (!todayList.length) return message.reply("Aaj ki koi appointment nahi hai");
            let reply = "📋 Aaj ki Appointments:\n\n";
            todayList.sort((a, b) => a.token - b.token).forEach(a => { reply += `Token: ${a.token}\nName: ${a.name}\nPhone: ${a.phone}\n\n`; });
            return message.reply(reply);
        }
        if (text === "history") {
            if (!Object.keys(appointments).length) return message.reply("Koi appointment nahi mili (7 din mein)");
            const grouped = {};
            Object.values(appointments).forEach(a => { if (!grouped[a.date]) grouped[a.date] = []; grouped[a.date].push(a); });
            let reply = "📅 Last 7 Days:\n\n";
            Object.keys(grouped).sort().forEach(date => {
                reply += `━━━ ${date} ━━━\n`;
                grouped[date].sort((a, b) => a.token - b.token).forEach(a => { reply += `Token ${a.token}: ${a.name} (${a.phone})\n`; });
                reply += "\n";
            });
            return message.reply(reply);
        }
        if (text === "reset") { tokenCounter = {}; appointments = {}; return message.reply("Tokens reset successfully ✅"); }
        if (text.startsWith("limit")) {
            const newLimit = parseInt(text.split(" ")[1]);
            if (!newLimit) return message.reply("Invalid number");
            dailyLimit = newLimit;
            return message.reply(`Daily limit set to ${dailyLimit}`);
        }
        if (text.startsWith("close ")) {
            const value = text.replace("close ", "").trim();
            if (value.match(/[0-9]/)) { closedDates.push(value); return message.reply(`${value} closed ❌`); }
            closedDays.push(value);
            return message.reply(`${value} closed ❌`);
        }
        if (text.startsWith("open ")) {
            const value = text.replace("open ", "").trim();
            closedDays = closedDays.filter(d => d !== value);
            closedDates = closedDates.filter(d => d !== value);
            return message.reply(`${value} opened ✅`);
        }
        if (text === "close") { clinicOpen = false; return message.reply("Clinic closed ❌"); }
        if (text === "open") { clinicOpen = true; return message.reply("Clinic open ✅"); }
        return;
    }

    if (!clinicOpen) return message.reply(t(senderRaw, "closed"));

    const today = new Date();
    const todayDay = today.toLocaleDateString("en-US", { weekday: "long" }).toLowerCase();
    const todayDate = today.toLocaleDateString("en-US", { day: "numeric", month: "long" }).toLowerCase();

    if (closedDays.includes(todayDay)) return message.reply(t(senderRaw, "closedDay", todayDay));
    if (closedDates.includes(todayDate)) return message.reply(t(senderRaw, "closedDate", todayDate));

    if (userState[senderRaw] && userState[senderRaw].step === 0) {
        if (text === 'hindi') { userLang[senderRaw] = 'hi'; userState[senderRaw] = { step: 1 }; return message.reply(msg.hi.welcome); }
        if (text === 'english') { userLang[senderRaw] = 'en'; userState[senderRaw] = { step: 1 }; return message.reply(msg.en.welcome); }
        return message.reply(msg.hi.selectLang);
    }

    if (userState[senderRaw] && userState[senderRaw].step >= 1) {
        if (userState[senderRaw].step === 1) { userState[senderRaw].name = message.body; userState[senderRaw].step = 2; return message.reply(t(senderRaw, 'askPhone')); }
        if (userState[senderRaw].step === 2) { userState[senderRaw].phone = message.body; userState[senderRaw].step = 3; return message.reply(t(senderRaw, 'askDate')); }
        if (userState[senderRaw].step === 3) {
            const date = new Date().toLocaleDateString('en-US', { day: 'numeric', month: 'long' }).toLowerCase();
            if (!tokenCounter[date]) tokenCounter[date] = 1;
            if (tokenCounter[date] > dailyLimit) { delete userState[senderRaw]; delete userLang[senderRaw]; return message.reply(t(senderRaw, 'full')); }
            const token = tokenCounter[date]++;
            appointments[userState[senderRaw].phone + '_' + Date.now()] = {
                name: userState[senderRaw].name, phone: userState[senderRaw].phone,
                date, token, timestamp: Date.now()
            };
            delete userState[senderRaw];
            delete userLang[senderRaw];
            return message.reply(t(senderRaw, 'confirmed', token));
        }
        return;
    }

    if (isTriggerWord(text)) { userState[senderRaw] = { step: 0 }; return message.reply(msg.hi.selectLang); }
});

    client.initialize();
}

startBot();
