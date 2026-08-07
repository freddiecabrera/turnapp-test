import path from "path";
import fs from "fs";
import dotenv from "dotenv";
import bcrypt from "bcryptjs";
import { PrismaClient } from "@prisma/client";

dotenv.config({ path: path.resolve(__dirname, "../../../.env") });

const prisma = new PrismaClient();

/**
 * SZN 1 cards, derived from
 * "SZN 1 - Collectible Cards, Probabilities, Prize Copy & Images - SZN 1.csv".
 * `num` matches the leading number of the image file in assets/SZN 1_cards/.
 */
const SZN1_CARDS: Array<{
  num: number;
  name: string;
  type: string;
  universe: string;
  rarity: string;
  rarityLevel: number;
  story: string;
  imageFile: string;
}> = [
  {
    num: 1,
    name: "must be nice",
    type: "afterglow",
    universe: "dreamstate",
    rarity: "daycard",
    rarityLevel: 1,    story:
      "You see it in their eyes, and then—they say it: \u201cmust be nice.\u201d They don\u2019t know the work it took to get here. You just smile, raise your glass, and let it glisten.",
    imageFile: "1_must be nice.png",
  },
  {
    num: 2,
    name: "retrovision",
    type: "drip",
    universe: "vaulted",
    rarity: "mythic",
    rarityLevel: 4,    story:
      "retrovision's not from here. He shows up when timelines misfire\u2014laced in vibrant color and dripped in memory. Not the past, but not quite the future... just vibes & sweet nostalgia.",
    imageFile: "2_retrovision.png",
  },
  {
    num: 3,
    name: "scotti",
    type: "icon",
    universe: "halovoid",
    rarity: "glow",
    rarityLevel: 2,    story:
      "Kick your worries to the curb and F-off to somewhere cool. Call your friends, get into mischief, break some rules. We won't tell, and neither will he.",
    imageFile: "3_scotti.png",
  },
  {
    num: 4,
    name: "/// trippple",
    type: "icon",
    universe: "halovoid",
    rarity: "daycard",
    rarityLevel: 1,    story:
      "A glitch in the fabric. Part beast, part vibe. Came through a wormhole, crashed the party, stayed for the buzz. Three eyes. One hoodie. Fur made of static and secrets.",
    imageFile: "4_trippple.png",
  },
  {
    num: 5,
    name: "23",
    type: "icon",
    universe: "foundry",
    rarity: "pulse",
    rarityLevel: 3,    story:
      "One gym. One crowd. Just the echo of sneakers on waxed wood. Before the banners, before the myth, it was just a number. You can wear it, chase it. But you'll never beat it.",
    imageFile: "5_23.png",
  },
  {
    num: 6,
    name: "ch\u00e2teau turnmont",
    type: "afterglow",
    universe: "dreamstate",
    rarity: "glow",
    rarityLevel: 2,    story:
      "Velvet robes. Half poured drinks. You weren\u2019t supposed to be there\u2014but one night rewired everything. Fame, failure, fire... not a hotel. A portal.",
    imageFile: "6_Chateau turnmont.png",
  },
  {
    num: 7,
    name: "electric daisy",
    type: "charge",
    universe: "botanica",
    rarity: "mythic",
    rarityLevel: 4,    story:
      "A buzz button bloom. Shrooms that shimmer. It hits like a kiss on a live wire\u2014warm, weird, and maybe not legal. Nobody asked, they just drank.",
    imageFile: "7_electric daisy.png",
  },
  {
    num: 8,
    name: "hollywood & chai",
    type: "flavorwave",
    universe: "vaulted",
    rarity: "daycard",
    rarityLevel: 1,    story:
      "turn's worst seller. Tasted amazing, but only Colby cared. He called it \u201cunderrated.\u201d You can still catch him dreaming of the day it makes its comeback.",
    imageFile: "8_hollywood & chai.png",
  },
  {
    num: 9,
    name: "lowercase t",
    type: "mythos",
    universe: "foundry",
    rarity: "daycard",
    rarityLevel: 1,    story:
      "Nobody knew who started wearing it. NBD. Then your barista wore one. Then your boss. Now your grandma won\u2019t take hers off. You just hope she doesn\u2019t start a podcast.",
    imageFile: "9_lowercase t.png",
  },
  {
    num: 10,
    name: "off--",
    type: "icon",
    universe: "foundry",
    rarity: "glow",
    rarityLevel: 2,    story:
      "He didn\u2019t just build brands. He bent space. Every cut, curve, and quote left a mark on culture... he just called it future. Designed for tomorrow, and delivered yesterday.",
    imageFile: "10_off.png",
  },
  {
    num: 11,
    name: "podpak",
    type: "drip",
    universe: "foundry",
    rarity: "pulse",
    rarityLevel: 3,    story:
      "2 pods. 1 pak. No posts. No buttons. No BS. A sleek little flex for those who get it. A mystery for those who don\u2019t.",
    imageFile: "11_podpak.png",
  },
  {
    num: 12,
    name: "rockstar",
    type: "flavorwave",
    universe: "dreamstate",
    rarity: "daycard",
    rarityLevel: 1,    story:
      "Came in singing sad songs and made face tatts mainstream. Then came the cowboy boots... no one could ignore it. Innovators get flack. Then they get copied.",
    imageFile: "12_rockstar.png",
  },
  {
    num: 13,
    name: "the brothers",
    type: "icon",
    universe: "campus legends",
    rarity: "pulse",
    rarityLevel: 3,    story:
      "Two underdogs. One cracked podpak. They flew to New York with nothing but a dream. This is their story: loyalty, hustle, and a chance to earn their turn.",
    imageFile: "13_the brothers.png",
  },
  {
    num: 14,
    name: "tokyo pink ros\u00e9",
    type: "afterglow",
    universe: "vaulted",
    rarity: "glow",
    rarityLevel: 2,    story:
      "420 floors up. A $10k flute of pink champagne with a diamond inside. Sweet and sparkling... a memory so rich, it still tastes real. We bottled a feeling & gave away the dream.",
    imageFile: "14_tokyo pink rose.png",
  },
  {
    num: 15,
    name: "Colby",
    type: "icon",
    universe: "campus legends",
    rarity: "heavenmade",
    rarityLevel: 5,    story:
      "Not officially on payroll or the guest list. But he\u2019s always there. Knows every flavor. Loves every flop. Never finishes a story, but loves to tell them. You found him... was it worth it?",
    imageFile: "15_Colby.png",
  },
];

const ASSETS_CARDS_DIR = path.resolve(__dirname, "../../../assets/SZN 1_cards");
const STATIC_CARDS_DIR = path.resolve(__dirname, "../static/cards");

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

/** Copy a card image into the API's static folder, returning the stored filename. */
function copyImage(num: number, name: string, sourceFile: string): string | null {
  const src = path.join(ASSETS_CARDS_DIR, sourceFile);
  if (!fs.existsSync(src)) {
    console.warn(`  ! image not found, skipping copy: ${sourceFile}`);
    return null;
  }
  const dest = `${num}_${slugify(name)}.png`;
  fs.mkdirSync(STATIC_CARDS_DIR, { recursive: true });
  fs.copyFileSync(src, path.join(STATIC_CARDS_DIR, dest));
  return dest;
}

async function main() {
  console.log("Seeding turn database...");

  // Fresh start (idempotent seed).
  await prisma.pointsTransaction.deleteMany();
  await prisma.userCard.deleteMany();
  await prisma.card.deleteMany();
  await prisma.user.deleteMany();
  await prisma.season.deleteMany();

  const season = await prisma.season.create({
    data: {
      name: "SZN 1",
      description: "turn's first season of collectibles. 15 cards to complete the set.",
    },
  });

  // A second, empty collection so the structure is visible in the admin. Add
  // cards + QR codes to it the same way as SZN 1.
  await prisma.season.create({
    data: {
      name: "Retrovision",
      description: "A coming-soon collection. No cards yet — add some in the admin.",
    },
  });

  const createdCards = [];
  for (const c of SZN1_CARDS) {
    const stored = copyImage(c.num, c.name, c.imageFile);
    const card = await prisma.card.create({
      data: {
        name: c.name,
        type: c.type,
        universe: c.universe,
        rarity: c.rarity,
        rarityLevel: c.rarityLevel,
        cardNumber: `${c.num}/15`,
        story: c.story,
        imageUrl: stored,
        seasonId: season.id,
      },
    });
    createdCards.push({ num: c.num, id: card.id });
  }
  console.log(`  created ${createdCards.length} cards`);

  const idByNum = new Map(createdCards.map((c) => [c.num, c.id]));

  // Admin user.
  await prisma.user.create({
    data: {
      username: "turn admin",
      email: "admin@turn.app",
      passwordHash: await bcrypt.hash("admin123", 10),
      userIdNumber: 1,
      pointsBalance: 0,
      isAdmin: true,
    },
  });

  // Demo user used for testing the app.
  const demoUser = await prisma.user.create({
    data: {
      username: "testing",
      email: "testing@turn.app",
      passwordHash: await bcrypt.hash("turn123", 10),
      userIdNumber: 100200,
      pointsBalance: 350,
      isAdmin: false,
    },
  });

  // A subset of owned cards (podpak owned x2 to show a duplicate badge).
  const owned: Array<{ num: number; quantity: number }> = [
    { num: 1, quantity: 1 },
    { num: 2, quantity: 1 },
    { num: 3, quantity: 1 },
    { num: 4, quantity: 1 },
    { num: 5, quantity: 1 },
    { num: 11, quantity: 2 },
    { num: 12, quantity: 1 },
    { num: 13, quantity: 1 },
  ];
  for (const o of owned) {
    const cardId = idByNum.get(o.num);
    if (!cardId) continue;
    await prisma.userCard.create({
      data: { userId: demoUser.id, cardId, quantity: o.quantity },
    });
  }
  console.log(`  gave ${owned.length} cards to ${demoUser.username}`);

  // Wallet history matching the Turnapp_Wallet screenshot.
  const history: Array<{ date: string; amount: number; description: string }> = [
    { date: "2026-04-15", amount: 100, description: "Campaign reward from download turn app" },
    { date: "2026-03-12", amount: 100, description: "Campaign reward from download turn app" },
    { date: "2026-02-25", amount: 50, description: "Scanned a podpak by turn. Note: The transaction has been tracked." },
    { date: "2026-01-29", amount: 100, description: "Campaign reward from download turn app. Note: welcome bonus." },
    { date: "2025-11-05", amount: 2000, description: "System reward. Note: The transaction has been tracked." },
    { date: "2025-09-22", amount: 50, description: "Scanned a turn verified collectible." },
  ];
  for (const h of history) {
    await prisma.pointsTransaction.create({
      data: {
        userId: demoUser.id,
        amount: h.amount,
        description: h.description,
        createdAt: new Date(h.date),
      },
    });
  }
  console.log(`  added ${history.length} wallet transactions`);

  // A handful of extra users with random-ish names, card collections, and
  // points history so the admin dashboard has more to look at.
  const firstNames = [
    "Alex", "Jordan", "Riley", "Casey", "Morgan", "Taylor", "Jamie", "Avery",
    "Quinn", "Reese", "Sky", "Rowan", "Blake", "Devon", "Elliot", "Harper",
  ];
  const lastNames = [
    "Reed", "Hayes", "Cross", "Vance", "Poole", "Marsh", "Quill", "Frost",
    "Blaze", "Nova", "Kane", "Wolfe", "Rhodes", "Sloan", "Pierce", "Vaughn",
  ];
  const txnTemplates = [
    "Scanned a turn verified collectible.",
    "Campaign reward from download turn app.",
    "Scanned a podpak by turn.",
    "System reward. Note: The transaction has been tracked.",
    "Welcome bonus.",
  ];

  const rand = (n: number) => Math.floor(Math.random() * n);
  const pick = <T,>(arr: T[]) => arr[rand(arr.length)];
  const totalCards = createdCards.length;

  const usedNames = new Set<string>();
  const extraCount = 8;
  for (let i = 0; i < extraCount; i++) {
    let username = "";
    do {
      username = `${pick(firstNames)} ${pick(lastNames)}`;
    } while (usedNames.has(username));
    usedNames.add(username);

    const handle = username.toLowerCase().replace(/[^a-z]+/g, ".");
    const user = await prisma.user.create({
      data: {
        username,
        email: `${handle}${i}@turn.app`,
        passwordHash: await bcrypt.hash("turn123", 10),
        userIdNumber: 100300 + i,
        pointsBalance: 0,
        isAdmin: false,
      },
    });

    // Random subset of cards.
    const shuffled = createdCards.map((c) => c.num).sort(() => Math.random() - 0.5);
    const owns = shuffled.slice(0, 1 + rand(Math.max(1, totalCards)));
    for (const num of owns) {
      const cardId = idByNum.get(num);
      if (!cardId) continue;
      await prisma.userCard.create({
        data: { userId: user.id, cardId, quantity: 1 + (Math.random() < 0.2 ? 1 : 0) },
      });
    }

    // Random points history + matching balance.
    const txnCount = 2 + rand(4);
    let balance = 0;
    for (let t = 0; t < txnCount; t++) {
      const amount = pick([50, 50, 100, 100, 250]);
      balance += amount;
      const daysAgo = rand(180);
      await prisma.pointsTransaction.create({
        data: {
          userId: user.id,
          amount,
          description: pick(txnTemplates),
          createdAt: new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000),
        },
      });
    }
    await prisma.user.update({ where: { id: user.id }, data: { pointsBalance: balance } });
  }
  console.log(`  created ${extraCount} extra random users`);

  console.log("Seed complete.");
  console.log("  Demo login:  testing@turn.app / turn123");
  console.log("  Admin login: admin@turn.app / admin123");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
