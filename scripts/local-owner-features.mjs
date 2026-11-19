// Local owner builds include both the production connection and its OS-backed
// persistent session. Public/synthetic Cargo builds retain their defaults.
export function withLocalOwnerFeatures(input) {
  const args = [...input];
  const index = args.indexOf('--features');
  const assignment = args.findIndex(arg => arg.startsWith('--features='));
  const required = ['production-connected-account', 'persistent-connected-account'];
  if (index >= 0) {
    if (!args[index + 1]) throw new Error('Missing value for --features');
    args[index + 1] = [...new Set([...args[index + 1].split(/[\s,]+/).filter(Boolean), ...required])].join(',');
  } else if (assignment >= 0) {
    const selected = args[assignment].slice('--features='.length).split(/[\s,]+/).filter(Boolean);
    args[assignment] = '--features=' + [...new Set([...selected, ...required])].join(',');
  } else {
    args.push('--features', required.join(','));
  }
  return args;
}
