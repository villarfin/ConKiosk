// Keep student details out of route URLs and browser history.
type Student = { student_id: string; full_name: string; program: string; year_level: string; section: string };
let draft: Student[] = [];
let submissionId = '';
export function setKioskDraft(students: Student[]) {
  draft = students;
  submissionId = 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, char => {
    const value = Math.floor(Math.random() * 16);
    return (char === 'x' ? value : (value & 3) | 8).toString(16);
  });
}
export const getKioskDraft = () => ({ students: draft, submissionId });
export function clearKioskDraft() { draft = []; submissionId = ''; }
