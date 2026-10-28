# Bilimlar bellashuvi — Knowledge Battle

**Muallif / Author: Sarvar Erkinjonov** — [github.com/erkinjonovsarvar](https://github.com/erkinjonovsarvar)

Profi University iqtisodiyot fakulteti talabalari uchun yaratilgan jonli test o'yini. O'qituvchi savollarni proyektorga chiqaradi, talabalar o'z telefonidan javob beradi, ekranda esa reyting jonli yangilanib turadi.

*A live classroom quiz game made for Profi University economics students: the teacher projects the questions, students answer on their phones, and the ranking updates live.*

---

## O'zbekcha

### Imkoniyatlar
- Talabalar QR-kod yoki havola orqali kiradi: ilova o'rnatish ham, ro'yxatdan o'tish ham kerak emas.
- **Ball:** to'g'ri javob uchun 500–1000 ball (qancha tez bo'lsa, shuncha ko'p), ketma-ket to'g'ri javoblar uchun +100…+500 bonus.
- **Jamoa rejimi:** 3–5 jamoa. Jamoa bali a'zolarining o'rtacha bali bo'ladi, shuning uchun jamoalar soni har xil bo'lsa ham adolatli.
- **O'qituvchi boshqaruvi:** pauza, +10 soniya, javoblarni oldinroq ochish, o'yinchini chiqarish, kim hali javob bermaganini ko'rish.
- **O'yin oxirida:** g'oliblar shohsupasi, eng qiyin savollar tahlili, natijalar Excel (CSV) faylida saqlanadi.
- **"Xatolarim ustida mashq":** har bir talaba faqat o'zi xato qilgan savollarni hammasi to'g'ri bo'lguncha qayta ishlaydi.
- **Yangi test:** Word (.docx) yoki .txt faylni o'qituvchi ekranidan yuklash kifoya.

### Ishga tushirish
1. [Node.js](https://nodejs.org) (LTS) ni o'rnating.
2. `O'YINNI BOSHLASH.bat` faylini ikki marta bosing. O'qituvchi ekrani brauzerda o'zi ochiladi.
3. Internet orqali o'ynash uchun [cloudflared](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/) ni o'rnating yoki `cloudflared.exe` ni shu papkaga qo'ying. Bo'lmasa, o'yin faqat bitta Wi-Fi tarmog'i ichida ishlaydi.

Batafsil qo'llanma: [QO'LLANMA.txt](QO'LLANMA.txt).

### Test formati
```
1-mavzu: Mavzu nomi
1. Savol matni
====
#To'g'ri javob
====
Noto'g'ri variant
====
Noto'g'ri variant
++++
```

Repozitoriyda faqat namuna test bor (`testlar/namuna.json`). O'z testlaringizni o'qituvchi ekranidan yuklang.

---

## English

### How it is built
- **`server.js`** uses only built-in Node.js modules (`http`, `fs`, `zlib`, `crypto`) and needs no npm packages.
- **Live updates** use long-polling: every phone keeps one request open, and changes made within 40 ms are sent together.
- **.docx tests** are read by a small built-in ZIP reader plus `zlib`, so no Word library is needed.
- **Fair play:** answer order can be shuffled for each player (seeded, so it stays the same after a refresh). Each game gets a random 6-digit PIN. Teacher actions need the host computer or a random admin key.
- **Internet access:** a Cloudflare quick tunnel gives a public HTTPS link, and the host screen shows it as a QR code.

### Files
| File | Purpose |
|---|---|
| `server.js` | game logic, scoring, teams, HTTP API, results export |
| `public/host.html` | teacher / projector screen |
| `public/player.html` | student phone screen |
| `public/brand.js` | university, faculty and game name |
| `testlar/` | test banks (JSON) |

Not in the repository: `sozlamalar.json` (it holds the admin password and is created on first start), `natijalar/` (student results), and the tunnel executable.

## License

© 2026 Sarvar Erkinjonov. All rights reserved. You may view and learn from the code. Ask the author before reusing it.
