// Load the same zsh login/interactive startup files as a terminal, then run the
// selected trusted launcher. Keep startup output off Chat's JSON protocol pipe.
// All paths, function names and CLI arguments remain positional shell arguments.
const bootstrap = `exec /bin/zsh -lic 'zq_project_dir=$1; shift; source "$1" >&2 || exit $?; shift; cd -- "$zq_project_dir" || exit $?; "$@" 1>&3 3>&-' zq-code "$@" 3>&1 1>&2`

function buildProfileLaunch(profile, cwd, args = [], managed = false) {
  // A managed native agent must stay in its launcher's group so shutdown can
  // reach the CLI behind a shell function. Startup files still run normally.
  const script = managed ? bootstrap.replace('; "$@"', '; unsetopt MONITOR; "$@"') : bootstrap
  return { file: '/bin/zsh', args: ['-c', script, 'zq-code', cwd, profile.launcherFile, profile.functionName, ...args], cwd }
}

module.exports = { buildProfileLaunch }
