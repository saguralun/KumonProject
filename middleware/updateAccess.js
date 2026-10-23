const loopbackAddresses = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

export function requireUpdateAccess(req, res, next) {
    const local = loopbackAddresses.has(req.socket.remoteAddress);
    const admin = req.session?.user?.role === 'admin';
    if (!local && !admin) return res.status(403).json({ success: false, error: 'กรุณาอัปเดตจากเครื่องที่เปิดโปรแกรม KumonDB' });
    const localOrigins = ['localhost', '127.0.0.1', '[::1]'].map((host) => new URL(`http://${host}:${req.socket.localPort}`).origin);
    const requestOrigin = `${req.protocol}://${req.get('host')}`;
    // Check the host as well as the socket to prevent DNS rebinding on localhost.
    if ((local && !localOrigins.includes(requestOrigin)) || req.get('sec-fetch-site') === 'cross-site' || (req.get('origin') && req.get('origin') !== requestOrigin)) {
        return res.status(403).json({ success: false, error: 'กรุณาเปิดอัปเดตจากหน้าโปรแกรมโดยตรง' });
    }
    if (!req.is('application/json') || req.body?.confirm !== true) return res.status(400).json({ success: false, error: 'กรุณายืนยันอัปเดตและรีสตาร์ตโปรแกรมก่อน' });
    next();
}
