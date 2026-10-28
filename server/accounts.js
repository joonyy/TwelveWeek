// Call inside a transaction. Keep shared OAuth client registrations, but remove
// every credential and record owned by this profile before deleting the profile.
export async function deleteProfileData(db, profileId) {
  const profile = await db.query(
    "SELECT id FROM profiles WHERE id=$1 FOR UPDATE",
    [profileId],
  );
  if (!profile.rowCount) return false;
  await db.query("DELETE FROM ai_oauth_codes WHERE profile_id=$1", [profileId]);
  await db.query("DELETE FROM ai_oauth_tokens WHERE profile_id=$1", [
    profileId,
  ]);
  await db.query(
    "DELETE FROM ai_vision_edits WHERE profile_id=$1 OR cycle_id IN (SELECT id FROM cycles WHERE profile_id=$1)",
    [profileId],
  );
  await db.query(
    "DELETE FROM changes WHERE profile_id=$1 OR cycle_id IN (SELECT id FROM cycles WHERE profile_id=$1)",
    [profileId],
  );
  // Cycle cascades remove weeks (including reading records/reviews), AI
  // conversations/permissions, calendar previews and cycle OAuth grants.
  await db.query("DELETE FROM cycles WHERE profile_id=$1", [profileId]);
  // Profile cascades remove all sessions and saved AI/calendar credentials.
  await db.query("DELETE FROM profiles WHERE id=$1", [profileId]);
  return true;
}

// Caller checks ownership, lifecycle and version while holding the cycle lock.
export async function deleteCycleData(db, cycleId) {
  await db.query("DELETE FROM ai_vision_edits WHERE cycle_id=$1", [cycleId]);
  await db.query("DELETE FROM changes WHERE cycle_id=$1", [cycleId]);
  // Other cycle-owned rows use ON DELETE CASCADE. Profile credentials stay.
  await db.query("DELETE FROM cycles WHERE id=$1", [cycleId]);
}
