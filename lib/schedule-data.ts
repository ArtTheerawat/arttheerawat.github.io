// Static weekly schedule data (ported from the old data/schedule.js globals).

export interface Course {
  code: string;
  name: string;
  color: string;
}

export interface CourseDef {
  name: string;
  color: string;
}

export interface Session {
  day: number; // 1=Mon .. 7=Sun
  start: number; // e.g. 10.0 = 10:00
  end: number; // e.g. 11.84
  code: string;
  room: string;
}

export interface Makeup extends Omit<Session, "day"> {
  date: string; // YYYY-MM-DD
  group: string;
  kind: "Lab" | "Lec";
  day?: number; // computed from date at render time
}

export const COURSES: Record<string, CourseDef> = {
  "88622065": { name: "Data Structures and Algorithms", color: "#6366f1" },
  "88624065": { name: "Relational Database", color: "#22d3ee" },
  "88624165": { name: "User Interface Design and Development", color: "#f59e0b" },
  "88634065": { name: "Software Development", color: "#22c55e" },
  "89520664": { name: "Experiential English", color: "#ef4444" },
  "89520864": { name: "Thai Language Skills for Careers in Contemporary Society", color: "#a855f7" },
  "73101469": { name: "Sexual Literacy", color: "#ec4899" },
};

export const SCHEDULE: Session[] = [
  // Mon
  { day: 1, start: 10.0, end: 11.84, code: "88624065", room: "IF-5M210" },
  { day: 1, start: 13.0, end: 16.84, code: "89520664", room: "KB-206" },
  // Tue
  { day: 2, start: 10.0, end: 11.84, code: "88634065", room: "IF-5M210" },
  { day: 2, start: 13.0, end: 14.84, code: "88624165", room: "IF-5M210" },
  { day: 2, start: 15.0, end: 16.84, code: "88624065", room: "IF-3C01" },
  // Wed
  { day: 3, start: 8.0, end: 9.84, code: "88624165", room: "IF-3C01" },
  { day: 3, start: 10.0, end: 11.84, code: "88622065", room: "IF-5T05" },
  { day: 3, start: 13.0, end: 15.84, code: "89520864", room: "ARR-เรียนออนไลน์" },
  { day: 3, start: 17.0, end: 18.84, code: "88634065", room: "IF-4C03" },
  // Thu
  { day: 4, start: 9.0, end: 11.84, code: "73101469", room: "ARR-เรียนออนไลน์" },
  // Fri
  { day: 5, start: 10.0, end: 11.84, code: "88622065", room: "IF-3C01" },
];

export const MAKEUP: Makeup[] = [
  { date: "2026-08-13", group: "G2", kind: "Lab", start: 13.0, end: 15.0, code: "88624165", room: "IF3C01" },
  { date: "2026-08-22", group: "G1-2", kind: "Lec", start: 10.0, end: 12.0, code: "88624165", room: "3M210" },
  { date: "2026-08-22", group: "G2", kind: "Lab", start: 15.0, end: 17.0, code: "88624165", room: "IF3C01" },
  { date: "2026-08-29", group: "G1-2", kind: "Lec", start: 10.0, end: 12.0, code: "88624165", room: "3M210" },
  { date: "2026-08-29", group: "G2", kind: "Lab", start: 15.0, end: 17.0, code: "88624165", room: "IF3C01" },
];

export function courseDef(code: string): CourseDef {
  return COURSES[code] || { name: code, color: "#22d3ee" };
}