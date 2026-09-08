import { getPanchangam, Observer } from "@ishubhamx/panchangam-js";

const TITHI_NAMES = [
  "प्रतिपदा", "द्वितीया", "तृतीया", "चतुर्थी", "पंचमी", "षष्ठी", "सप्तमी", "अष्टमी",
  "नवमी", "दशमी", "एकादशी", "द्वादशी", "त्रयोदशी", "चतुर्दशी", "पौर्णिमा",
  "प्रतिपदा", "द्वितीया", "तृतीया", "चतुर्थी", "पंचमी", "षष्ठी", "सप्तमी", "अष्टमी",
  "नवमी", "दशमी", "एकादशी", "द्वादशी", "त्रयोदशी", "चतुर्दशी", "अमावस्या",
];

const NAKSHATRA_NAMES = [
  "अश्विनी", "भरणी", "कृत्तिका", "रोहिणी", "मृगशीर्ष", "आर्द्रा", "पुनर्वसू", "पुष्य",
  "आश्लेषा", "मघा", "पूर्वा फाल्गुनी", "उत्तरा फाल्गुनी", "हस्त", "चित्रा", "स्वाती",
  "विशाखा", "अनुराधा", "ज्येष्ठा", "मूळ", "पूर्वाषाढा", "उत्तराषाढा", "श्रवण",
  "धनिष्ठा", "शततारका", "पूर्वा भाद्रपदा", "उत्तरा भाद्रपदा", "रेवती",
];

const MASA_NAMES = [
  "चैत्र", "वैशाख", "ज्येष्ठ", "आषाढ", "श्रावण", "भाद्रपद",
  "आश्विन", "कार्तिक", "मार्गशीर्ष", "पौष", "माघ", "फाल्गुन",
];

const FESTIVAL_NAMES = new Map([
  ["Sankashti Chaturthi", "संकष्टी चतुर्थी"],
  ["Janmashtami (Smarta)", "श्रीकृष्ण जन्माष्टमी"],
  ["Dahi Handi", "दहीहंडी"],
  ["Shravana Somvara", "श्रावणी सोमवार"],
  ["Aja Ekadashi", "अजा एकादशी"],
  ["Ekadashi Parana", "एकादशी पारणे"],
  ["Pradosham (Krishna)", "कृष्ण प्रदोष"],
  ["Pradosham (Shukla)", "शुक्ल प्रदोष"],
  ["Masik Shivaratri", "मासिक शिवरात्री"],
  ["Amavasya", "अमावस्या"],
  ["Hartalika Teej", "हरतालिका"],
  ["Gowri Habba", "गौरी पूजन"],
  ["Ganesh Chaturthi", "गणेश चतुर्थी"],
  ["Vinayaka Chaturthi", "विनायक चतुर्थी"],
  ["Rishi Panchami", "ऋषी पंचमी"],
  ["Nuakhai Juhar", "नुआखाई"],
  ["Radha Ashtami", "राधाष्टमी"],
  ["Durva Ashtami", "दुर्वाष्टमी"],
  ["Parsva Ekadashi (Parivartini)", "परिवर्तिनी एकादशी"],
  ["Vamana Jayanti", "वामन जयंती"],
  ["Anant Chaturdashi", "अनंत चतुर्दशी"],
  ["Ganesh Visarjan", "गणेश विसर्जन"],
  ["Purnima Shraddha", "पौर्णिमा श्राद्ध"],
  ["Purnima", "पौर्णिमा"],
]);

function iso(value) {
  return value instanceof Date && !Number.isNaN(value.valueOf()) ? value.toISOString() : null;
}

function translateFestival(name) {
  if (FESTIVAL_NAMES.has(name)) return FESTIVAL_NAMES.get(name);
  const ganeshDay = name.match(/^(.*) \(Day (\d+)\)$/);
  if (ganeshDay) {
    const dayNames = new Map([
      ["Ganesh Panchami", "गणेश पंचमी"], ["Shashthi", "षष्ठी"], ["Saptami", "सप्तमी"],
      ["Ashtami", "अष्टमी"], ["Navami", "नवमी"], ["Dashami", "दशमी"],
      ["Ekadashi", "एकादशी"], ["Dwadashi", "द्वादशी"],
      ["Prathama Shraddha", "प्रतिपदा श्राद्ध"], ["Dwitiya Shraddha", "द्वितीया श्राद्ध"],
      ["Tritiya Shraddha", "तृतीया श्राद्ध"], ["Chaturthi Shraddha", "चतुर्थी श्राद्ध"],
    ]);
    return `${FESTIVAL_NAMES.get(ganeshDay[1]) || dayNames.get(ganeshDay[1]) || ganeshDay[1]} · दिवस ${ganeshDay[2]}`;
  }
  const shraddha = name.match(/^(Prathama|Dwitiya|Tritiya|Chaturthi) Shraddha/);
  if (shraddha) {
    const names = { Prathama: "प्रतिपदा", Dwitiya: "द्वितीया", Tritiya: "तृतीया", Chaturthi: "चतुर्थी" };
    return `${names[shraddha[1]]} श्राद्ध`;
  }
  const numberedDay = name.match(/^(.*) Day (\d+)$/);
  if (numberedDay) {
    const base = numberedDay[1] === "Ganesh Utsav" ? "गणेशोत्सव" : numberedDay[1];
    return `${base} · दिवस ${numberedDay[2]}`;
  }
  return name;
}

function moonSymbol(tithi) {
  if (tithi === 14) return "🌕";
  if (tithi === 29) return "🌑";
  if (tithi <= 6) return "🌒";
  if (tithi <= 13) return "🌔";
  if (tithi <= 21) return "🌖";
  return "🌘";
}

export function buildMonthlyPanchang({ year, month, latitude, longitude, elevation = 0 }) {
  const observer = new Observer(latitude, longitude, elevation);
  const dayCount = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const days = [];

  for (let day = 1; day <= dayCount; day += 1) {
    // Noon IST keeps the civil date stable while the library anchors Panchang values at local sunrise.
    const date = new Date(Date.UTC(year, month - 1, day, 6, 30));
    const value = getPanchangam(date, observer);
    // The engine exposes Purnimanta masa and a zero-based tithi index at runtime.
    // Maharashtra follows Amanta: Krishna paksha remains in the preceding lunar month.
    const rawMasaIndex = value.masa?.index ?? 0;
    const amantaMasaIndex = value.paksha === "Krishna" ? (rawMasaIndex + 11) % 12 : rawMasaIndex;
    const masaName = MASA_NAMES[amantaMasaIndex] || value.masa?.name || "";
    const tithiName = TITHI_NAMES[value.tithi] || "";
    const festivalDetails = (value.festivals || []).map((festival) => ({
      name: translateFestival(festival.name),
      category: festival.category,
    }));
    const festivals = [...new Set(festivalDetails.map((festival) => festival.name))];
    const featuredFestivals = [...new Set(festivalDetails
      .filter((festival) => {
        if (festival.name.includes("दिवस") && !/(गणेश चतुर्थी|अनंत चतुर्दशी|गणेश विसर्जन)/.test(festival.name)) return false;
        if (["major", "ekadashi"].includes(festival.category)) return true;
        return /(संकष्टी|अमावस्या|पौर्णिमा|हरतालिका|ऋषी पंचमी|प्रदोष)/.test(festival.name);
      })
      .map((festival) => festival.name))];

    days.push({
      day,
      date: `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
      weekday: value.vara,
      tithi: value.tithi,
      tithiName,
      tithiEnd: iso(value.tithiEndTime),
      paksha: value.paksha === "Krishna" ? "कृष्ण" : "शुक्ल",
      masa: `${value.masa?.isAdhika ? "अधिक " : ""}${masaName}`,
      nakshatra: NAKSHATRA_NAMES[value.nakshatra] || "",
      nakshatraEnd: iso(value.nakshatraEndTime),
      sunrise: iso(value.sunrise),
      sunset: iso(value.sunset),
      moonrise: iso(value.moonrise),
      moonset: iso(value.moonset),
      rahuStart: iso(value.rahuKalamStart),
      rahuEnd: iso(value.rahuKalamEnd),
      moonSymbol: moonSymbol(value.tithi),
      festivals,
      featuredFestivals,
      samvat: value.samvat,
    });
  }

  return { year, month, latitude, longitude, elevation, days };
}
