export function consultationStatusLabel(consultation: { status: string; queue_id?: string | null }) {
  return consultation.status === 'scheduled' && consultation.queue_id ? 'WAITING' : consultation.status.toUpperCase();
}
