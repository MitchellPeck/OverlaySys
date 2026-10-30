/**
 * Drops results from superseded async runs: `begin()` starts a run and returns
 * a check that stays true only until the next `begin()`. For "the latest pick
 * wins" flows where an earlier, slower read could otherwise finish last.
 */
export function latestOnly(): { begin(): () => boolean } {
  let latest = 0;
  return {
    begin() {
      const run = ++latest;
      return () => run === latest;
    },
  };
}
