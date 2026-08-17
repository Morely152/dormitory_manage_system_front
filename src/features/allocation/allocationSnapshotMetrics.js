const EMPTY_METRICS = Object.freeze({
  emptyRooms: 0,
  emptyRoomBeds: 0,
  vacancyRooms: 0,
  vacancyBeds: 0,
})

export function getAllocationSnapshotMetrics(snapshot, collegeId = 'ALL') {
  return snapshot?.collegeMetrics?.[String(collegeId)] || EMPTY_METRICS
}
