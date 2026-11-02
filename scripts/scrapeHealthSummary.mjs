export function summarizeScrapeHealth(health) {
  const count = key => Number.isFinite(Number(health?.[key])) ? Number(health[key]) : 0;
  const attempted = count('attempted');
  const validPages = count('validPages');
  const savedObservations = count('savedObservations');
  const blocked = count('blocked');
  const transientFailures = count('transientFailures');
  const cooldownSkipped = count('cooldownSkipped');
  const inScopeStations = count('inScopeStations');

  let status = 'no-attempt';
  let title = 'No pricing refresh attempts were made';
  if (attempted === 0 && cooldownSkipped > 0) {
    status = 'cooldown';
    title = 'Refresh skipped: all in-scope stations are cooling down';
  } else if (blocked > 0 && savedObservations === 0) {
    status = 'blocked';
    title = 'Tesla access controls blocked this refresh';
  } else if (savedObservations > 0) {
    status = 'captured';
    title = 'New price observations were saved';
  } else if (attempted > 0) {
    status = 'no-price';
    title = 'Stations were checked, but no new prices were captured';
  }

  const lines = [
    `- **Refresh status:** ${title}`,
    `- Stations in scope: ${inScopeStations}`,
    `- Stations attempted: ${attempted}`,
    `- Valid pages: ${validPages}`,
    `- New price observations: ${savedObservations}`,
    `- Access-controlled / blocked: ${blocked}`,
    `- Transient failures: ${transientFailures}`,
    `- Skipped by cooldown: ${cooldownSkipped}`
  ];
  const annotation = status === 'blocked'
    ? 'Tesla/Akamai blocked the automated requests. No new price observations were saved; existing historical data was retained.'
    : status === 'cooldown'
      ? 'No network requests were made because every in-scope station was still inside its retry cooldown.'
      : status === 'no-price'
        ? 'The refresh ran but produced no new price observations. Do not interpret this as current pricing coverage.'
        : null;

  return { status, title, lines, annotation };
}
