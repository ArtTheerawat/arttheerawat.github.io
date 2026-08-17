/* 📚 ตารางเรียนรายสัปดาห์ — แก้ไขได้เองที่นี่
 *
 * SCHEDULE: คาบเรียนรายวันของน้า (จากตารางที่ให้)
 *   day  : 1=จันทร์ ... 7=อาทิตย์
 *   start: เวลาเริ่ม (ชั่วโมง, ทศนิยม เช่น 10:00=10.0, 13:00=13.0)
 *   end  : เวลาเลิก   (เช่น 13:00-16:50 --> end=16.83)
 *   code : รหัสวิชา (key ใน COURSES ด้านล่าง)
 *   room : ห้องเรียน (หรือ ARR-เรียนออนไลน์)
 * COURSES: ชื่อวิชา + สี ที่จะขึ้นบนเว็บ  (code เป็น key)
 */
window.COURSES = {
  "88622065": { name: "Data Structures and Algorithms", color: "#6366f1" },
  "88624065": { name: "Relational Database", color: "#22d3ee" },
  "88624165": { name: "User Interface Design and Development", color: "#f59e0b" },
  "88634065": { name: "Software Development", color: "#22c55e" },
  "89520664": { name: "Experiential English", color: "#ef4444" },
  "89520864": { name: "Thai Language Skills for Careers in Contemporary Society", color: "#a855f7" },
  "73101469": { name: "Sexual Literacy", color: "#ec4899" },
};

window.SCHEDULE = [
  // จันทร์
  { day: 1, start: 10.0, end: 11.84, code: "88624065", room: "IF-5M210" },
  { day: 1, start: 13.0, end: 16.84, code: "89520664", room: "KB-206" },
  // อังคาร
  { day: 2, start: 10.0, end: 11.84, code: "88634065", room: "IF-5M210" },
  { day: 2, start: 13.0, end: 14.84, code: "88624165", room: "IF-5M210" },
  { day: 2, start: 15.0, end: 16.84, code: "88624065", room: "IF-3C01" },
  // พุธ
  { day: 3, start: 8.0,  end: 9.84,  code: "88624165", room: "IF-3C01" },
  { day: 3, start: 10.0, end: 11.84, code: "88622065", room: "IF-5T05" },
  { day: 3, start: 13.0, end: 15.84, code: "89520864", room: "ARR-เรียนออนไลน์" },
  { day: 3, start: 17.0, end: 18.84, code: "88634065", room: "IF-4C03" },
  // พฤหัสบดี
  { day: 4, start: 9.0,  end: 11.84, code: "73101469", room: "ARR-เรียนออนไลน์" },
  // ศุกร์
  { day: 5, start: 10.0, end: 11.84, code: "88622065", room: "IF-3C01" },
];