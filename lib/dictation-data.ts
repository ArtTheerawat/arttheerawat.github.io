// Dictation trainer dataset (ported verbatim from the legacy dictation.html).

export interface DictItem {
  id: number;
  sentence: string; // contains ________ placeholder
  full_sentence: string;
  answer: string;
  alt_answers: string[];
  tip: string;
}

export interface DictTopic {
  title: string;
  description: string;
  items: DictItem[];
}

export type TopicKey = "relationships" | "coffee" | "smiley" | "chillies";

export const DATASET: Record<TopicKey, DictTopic> = {
  relationships: {
    title: "Relationships",
    description: "ความสัมพันธ์ รูปแบบความสัมพันธ์ และวัฒนธรรม",
    items: [
      { id: 1, sentence: "No one lives entirely by ________.", full_sentence: "No one lives entirely by themselves.", answer: "themselves", alt_answers: ["themselves"], tip: "สรรพนามสะท้อน (Reflexive Pronoun) ลงท้ายด้วย -selves สำหรับพหูพจน์" },
      { id: 2, sentence: "There are many kinds of ________.", full_sentence: "There are many kinds of relationships.", answer: "relationships", alt_answers: ["relationships"], tip: "คำนามพหูพจน์หลัง 'many kinds of' อย่าลืมเติม -s" },
      { id: 3, sentence: "Family relationships exist in all ________.", full_sentence: "Family relationships exist in all cultures.", answer: "cultures", alt_answers: ["cultures"], tip: "คำนามพหูพจน์หลัง 'all' อย่าลืมเติม -s" },
      { id: 4, sentence: "Attachment theory describes ________ inter-personal relationships.", full_sentence: "Attachment theory describes long-term inter-personal relationships.", answer: "long-term", alt_answers: ["long-term", "long term"], tip: "Compound adjective ขยายคำนาม มักมีเครื่องหมายยัติภังค์ (hyphen)" },
      { id: 5, sentence: "A relationship which ________ the maintenance of love between a man and a woman.", full_sentence: "A relationship which recognises the maintenance of love between a man and a woman.", answer: "recognises", alt_answers: ["recognises", "recognizes"], tip: "Subject-Verb Agreement: ประธานเอกพจน์ กริยาเติม -s / -es (recognises / recognizes)" },
      { id: 6, sentence: "Many couples are quite happy to ________.", full_sentence: "Many couples are quite happy to live together.", answer: "live together", alt_answers: ["live together"], tip: "หลัง Infinitive with 'to' ตามด้วย V.infinitive คือ live together" },
      { id: 7, sentence: "It is estimated that over 40% of ________ in Western countries end in divorce.", full_sentence: "It is estimated that over 40% of marriages in Western countries end in divorce.", answer: "marriages", alt_answers: ["marriages"], tip: "คำนามพหูพจน์หลังเปอร์เซ็นต์ (over 40% of marriages)" },
      { id: 8, sentence: "Other cultures have different ________.", full_sentence: "Other cultures have different customs.", answer: "customs", alt_answers: ["customs"], tip: "ขนบธรรมเนียม (customs) เติม -s" },
      { id: 9, sentence: "Marriage may not be based on romantic love but arranged by the family for religious or economic ________.", full_sentence: "Marriage may not be based on romantic love but arranged by the family for religious or economic reasons.", answer: "reasons", alt_answers: ["reasons"], tip: "เหตุผลหลายประการ (economic reasons) เติม -s" },
      { id: 10, sentence: "What would he have said about Internet ________?", full_sentence: "What would he have said about Internet friends?", answer: "friends", alt_answers: ["friends"], tip: "เพื่อนในอินเทอร์เน็ต เติม -s เป็นพหูพจน์" },
    ],
  },
  coffee: {
    title: "Ethiopian Coffee",
    description: "ประวัติศาสตร์และกระบวนการทำกาแฟเอธิโอเปีย",
    items: [
      { id: 1, sentence: "Coffee was ________ 1,000 years ago.", full_sentence: "Coffee was discovered 1,000 years ago.", answer: "discovered", alt_answers: ["discovered"], tip: "Passive voice ในอดีต (was + V.3) อย่าลืมเติม -ed" },
      { id: 2, sentence: "His animals were very lively and ________.", full_sentence: "His animals were very lively and excited.", answer: "excited", alt_answers: ["excited"], tip: "Adjective แสดงความรู้สึกตื่นเต้น เติม -ed" },
      { id: 3, sentence: "He ________ to try them himself.", full_sentence: "He decided to try them himself.", answer: "decided", alt_answers: ["decided"], tip: "Past Simple Tense กริยาช่อง 2 เติม -d" },
      { id: 4, sentence: "He liked the taste and the good feeling ________.", full_sentence: "He liked the taste and the good feeling energy.", answer: "energy", alt_answers: ["energy"], tip: "คำนาม energy (พลังงาน/ความกระปรี้กระเปร่า)" },
      { id: 5, sentence: "The ________ beans were rescued from the fire.", full_sentence: "The roasted beans were rescued from the fire.", answer: "roasted", alt_answers: ["roasted"], tip: "Participle ทำหน้าที่ขยาย beans (เมล็ดที่ถูกคั่ว) เติม -ed" },
      { id: 6, sentence: "The monks ________ to eat the beans to keep awake.", full_sentence: "The monks used to eat the beans to keep awake.", answer: "used", alt_answers: ["used"], tip: "used to แปลว่า เคยกระทำในอดีต (สะกด used)" },
      { id: 7, sentence: "That is where the name coffee ________.", full_sentence: "That is where the name coffee originated.", answer: "originated", alt_answers: ["originated"], tip: "Past Simple Tense กริยาช่อง 2 originate เติม -d" },
      { id: 8, sentence: "The process starts with the ________ green beans.", full_sentence: "The process starts with the dried green beans.", answer: "dried", alt_answers: ["dried"], tip: "กริยา dry เปลี่ยน y เป็น i แล้วเติม -ed ขยายคำนาม" },
      { id: 9, sentence: "The coffee is ________ in a special coffee pot.", full_sentence: "The coffee is prepared in a special coffee pot.", answer: "prepared", alt_answers: ["prepared"], tip: "Passive voice (is + V.3) กริยา prepare เติม -d" },
      { id: 10, sentence: "It is traditional to be ________ three small cups.", full_sentence: "It is traditional to be served three small cups.", answer: "served", alt_answers: ["served"], tip: "Passive infinitive (to be + V.3) กริยา serve เติม -d" },
    ],
  },
  smiley: {
    title: "Smiley Face",
    description: "ต้นกำเนิดและวิวัฒนาการของหน้ายิ้มและอีโมติคอน",
    items: [
      { id: 1, sentence: "There is disagreement about the origin of the smiley ________.", full_sentence: "There is disagreement about the origin of the smiley face.", answer: "face", alt_answers: ["face"], tip: "คำนาม face (ใบหน้า)" },
      { id: 2, sentence: "An early sighting of a ________ face on a movie poster was recorded in 1948.", full_sentence: "An early sighting of a happy face on a movie poster was recorded in 1948.", answer: "happy", alt_answers: ["happy"], tip: "Adjective ขยาย face คือ happy" },
      { id: 3, sentence: "In 1963, a ________ face appeared on The Funny Company, a popular children's TV programme.", full_sentence: "In 1963, a smiley face appeared on The Funny Company, a popular children's TV programme.", answer: "smiley", alt_answers: ["smiley"], tip: "คำคุณศัพท์ smiley face" },
      { id: 4, sentence: "T-shirts, picture books, coffee mugs, bumper stickers, ________ magnets.", full_sentence: "T-shirts, picture books, coffee mugs, bumper stickers, fridge magnets.", answer: "fridge", alt_answers: ["fridge"], tip: "ตู้เย็น (fridge) ใช้เป็น Noun adjunct ขยาย magnets" },
      { id: 5, sentence: "It went through multiple ________.", full_sentence: "It went through multiple variations.", answer: "variations", alt_answers: ["variations"], tip: "ตามหลัง multiple (หลากหลาย) ต้องเป็นคำนามพหูพจน์ variations (-s)" },
      { id: 6, sentence: "________ have become absolutely necessary for text messages.", full_sentence: "Emoticons have become absolutely necessary for text messages.", answer: "Emoticons", alt_answers: ["Emoticons", "emoticons"], tip: "ขึ้นต้นประโยค ต้องใช้ตัวพิมพ์ใหญ่ (Capital letter) 'Emoticons' และเป็นพหูพจน์" },
      { id: 7, sentence: "How many feelings apart from ________ are now represented by the familiar yellow face?", full_sentence: "How many feelings apart from happiness are now represented by the familiar yellow face?", answer: "happiness", alt_answers: ["happiness"], tip: "คำนาม happiness (ความสุข) หลังคำบุพบท apart from" },
      { id: 8, sentence: "With very short messages and no ________ expressions or body language to show your true feelings.", full_sentence: "With very short messages and no facial expressions or body language to show your true feelings.", answer: "facial", alt_answers: ["facial"], tip: "Adjective ขยาย expressions คือ facial (ทางสีหน้า)" },
      { id: 9, sentence: "There was also a smiley face that ________ that the sender was making a joke.", full_sentence: "There was also a smiley face that showed that the sender was making a joke.", answer: "showed", alt_answers: ["showed"], tip: "กริยาช่อง 2 ในอดีต showed (-ed)" },
      { id: 10, sentence: "The ________ was considering judging restaurants by using smiley or sad faces.", full_sentence: "The government was considering judging restaurants by using smiley or sad faces.", answer: "government", alt_answers: ["government"], tip: "คำนาม government (รัฐบาล)" },
    ],
  },
  chillies: {
    title: "Chillies",
    description: "ประวัติศาสตร์ ความเผ็ด และการใช้งานพริกในระดับโลก",
    items: [
      { id: 1, sentence: "________ come in many shapes and sizes.", full_sentence: "Chillies come in many shapes and sizes.", answer: "Chillies", alt_answers: ["Chillies", "chillies", "Chilies", "chilies"], tip: "ขึ้นต้นประโยค ใช้ตัวพิมพ์ใหญ่ Chillies (พหูพจน์เพราะกริยาคือ come ไม่เติม s)" },
      { id: 2, sentence: "Be ________ of the chillies that are bright red.", full_sentence: "Be careful of the chillies that are bright red.", answer: "careful", alt_answers: ["careful"], tip: "หลัง Be + Adj. -> Be careful (ระมัดระวัง)" },
      { id: 3, sentence: "Chillies may have been the first ________ to be grown for human consumption.", full_sentence: "Chillies may have been the first crop to be grown for human consumption.", answer: "crop", alt_answers: ["crop"], tip: "พืชผลการเกษตร (crop)" },
      { id: 4, sentence: "When Christopher Columbus arrived in America in 1492, he ________ across the fruit and called them chilli peppers.", full_sentence: "When Christopher Columbus arrived in America in 1492, he came across the fruit and called them chilli peppers.", answer: "came", alt_answers: ["came"], tip: "Past Simple V.2 -> come across เปลี่ยนเป็น came across (พบเจอโดยบังเอิญ)" },
      { id: 5, sentence: "They were also used in ________, especially for the relief of pain.", full_sentence: "They were also used in medicines, especially for the relief of pain.", answer: "medicines", alt_answers: ["medicines", "medicine"], tip: "ยารักษาโรค (medicines) เติม -s" },
      { id: 6, sentence: "With India being the world's largest ________, consumer and exporter.", full_sentence: "With India being the world's largest producer, consumer and exporter.", answer: "producer", alt_answers: ["producer"], tip: "ผู้ผลิต (producer) คู่กับ consumer และ exporter" },
      { id: 7, sentence: "This is not surprising for anyone who has eaten a hot Indian ________.", full_sentence: "This is not surprising for anyone who has eaten a hot Indian curry.", answer: "curry", alt_answers: ["curry"], tip: "แกงกะหรี่อินเดีย (Indian curry)" },
      { id: 8, sentence: "The title of the ________ chilli ever grown is hotly contested by many countries.", full_sentence: "The title of the hottest chilli ever grown is hotly contested by many countries.", answer: "hottest", alt_answers: ["hottest"], tip: "ขั้นสูงสุด Superlative (the hottest) พริกที่เผ็ดที่สุด" },
      { id: 9, sentence: "He originally developed the ________ by tasting.", full_sentence: "He originally developed the scale by tasting.", answer: "scale", alt_answers: ["scale"], tip: "มาตราวัดความเผ็ด (Scoville scale)" },
      { id: 10, sentence: "They are ________ as weapons-grade.", full_sentence: "They are classed as weapons-grade.", answer: "classed", alt_answers: ["classed", "classified"], tip: "Passive voice (are + V.3) ถูกจัดระดับ คือ classed (-ed)" },
    ],
  },
};

export const TOPIC_KEYS = Object.keys(DATASET) as TopicKey[];

export interface DictQuestion extends DictItem {
  topicTitle: string;
}

// Build the question list for a topic key, or a random 40-question exam when "all".
export function buildQuestions(key: TopicKey | "all"): DictQuestion[] {
  if (key === "all") {
    const all: DictQuestion[] = [];
    TOPIC_KEYS.forEach((k) =>
      DATASET[k].items.forEach((it) => all.push({ ...it, topicTitle: DATASET[k].title }))
    );
    return all.sort(() => Math.random() - 0.5);
  }
  return DATASET[key].items.map((it) => ({ ...it, topicTitle: DATASET[key].title }));
}