// Sends raw bytes straight to a network-connected receipt printer over a
// plain TCP socket on port 9100 (the near-universal "raw"/JetDirect-style
// printing port thermal/POS printers listen on — including this Xprinter,
// once it's on Ethernet with a fixed IP). No Windows printer queue, no
// driver, no Chrome — just bytes over a socket, which is why this path is
// worth switching to once a LAN cable is available: it sidesteps every
// class of problem the USB/Windows-spooler path ran into.
import net from "net";
import { httpError } from "./httpError.js";

const CONNECT_TIMEOUT_MS = 5000;

export function sendViaLan(buffer, host, port) {
    return new Promise((resolve, reject) => {
        const socket = new net.Socket();
        let settled = false;

        const finish = (error) => {
            if (settled) {
                return;
            }
            settled = true;
            socket.destroy();
            if (error) {
                reject(error);
            } else {
                resolve();
            }
        };

        socket.setTimeout(CONNECT_TIMEOUT_MS);

        socket.on("timeout", () => {
            finish(httpError(504, `เชื่อมต่อเครื่องพิมพ์ (LAN ${host}:${port}) หมดเวลา`));
        });

        socket.on("error", (error) => {
            finish(httpError(502, `เชื่อมต่อเครื่องพิมพ์ (LAN ${host}:${port}) ไม่สำเร็จ: ${error.message}`));
        });

        socket.connect(port, host, () => {
            socket.write(buffer, (writeError) => {
                if (writeError) {
                    finish(httpError(502, `ส่งข้อมูลไปเครื่องพิมพ์ไม่สำเร็จ: ${writeError.message}`));
                    return;
                }
                socket.end();
                finish(null);
            });
        });
    });
}
