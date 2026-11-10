// Keep student details out of route URLs and browser history.
type Student = { student_id: string; full_name: string; program: string; year_level: string; section: string };
export type KioskVisitor = { full_name: string; purpose: string };
let draft: Student[] = [];
let visitor: KioskVisitor | null = null;
let submissionId = '';
export function setKioskDraft(students: Student[], nextVisitor: KioskVisitor | null = null) {
  draft = students;
  visitor = nextVisitor;
  submissionId = 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, char => {
    const value = Math.floor(Math.random() * 16);
    return (char === 'x' ? value : (value & 3) | 8).toString(16);
  });
}
export const getKioskDraft = () => ({ students: draft, visitor, submissionId });
export function clearKioskDraft() { draft = []; visitor = null; submissionId = ''; }
