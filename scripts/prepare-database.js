// An older running updater calls this newly downloaded file once before restart.
// The automatic database preparation feature has been retired; importing no
// application/database modules keeps this compatibility step entirely inert.
if (process.argv[2] === '--update') {
    process.stdout.write(JSON.stringify({ ready: true, applied: false, retired: true }) + '\n');
} else {
    process.stderr.write('Automatic database preparation has been retired.\n');
    process.exitCode = 1;
}
