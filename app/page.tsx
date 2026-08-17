import Link from "next/link";

const TILES = [
  {
    href: "/today",
    ico: "📚",
    t: "เช็คงานวันนี้",
    d: "การบ้าน / งานค้าง / ครบกำหนดวันนี้ + แจ้งเตือนสอบ",
  },
  {
    href: "/schedule",
    ico: "🗓️",
    t: "ตารางเรียน",
    d: "คาบเรียนรายสัปดาห์ + วิชาชดเชย · คลิกวิชาเห็นงานที่ต้องส่ง",
  },
  {
    href: "/trading",
    ico: "📊",
    t: "Trading Dashboard",
    d: "XAUUSD / BTC · Performance · P&L · Signals",
  },
  {
    href: "/dictation",
    ico: "🔊",
    t: "Dictation Trainer",
    d: "Experiential English 89520664 · ฝึกฟัง + ตรวจเสียงลงท้าย -s/-ed ก่อนสอบ",
  },
];

export default function HomePage() {
  return (
    <div className="wrap">
      <div className="hero">
        <div className="logo">🎛️</div>
        <div>
          <h1>
                      Thee<span className="dot">Deck</span>
                    </h1>
                    <div className="sub">ศูนย์บัญชาการส่วนตัวของธีรวัฒน์</div>
        </div>
      </div>

      <div className="cards">
        {TILES.map((tl) => (
          <Link key={tl.href} href={tl.href} className="tile">
            <div className="ico">{tl.ico}</div>
            <div className="t">{tl.t}</div>
            <div className="d">{tl.d}</div>
            <div className="go">เปิด →</div>
          </Link>
        ))}
      </div>

      <footer>Auto-generated · ข้อมูลเรียนเชื่อม Google Classroom + Calendar</footer>
    </div>
  );
}