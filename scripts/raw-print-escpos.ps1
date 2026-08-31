# Sends raw bytes (ESC/POS commands) straight to a Windows printer queue's
# spooler, bypassing the whole GDI/print-preview pipeline entirely — no
# Chrome, no window.print(), no dialog. This is the standard Win32
# "RawPrinterHelper" pattern (winspool.drv OpenPrinter/StartDocPrinter/
# WritePrinter/EndDocPrinter with datatype "RAW"), used by most real POS
# software on Windows for exactly this reason: browser print dialogs are
# unreliable for headless/unattended receipt printing.
#
# Usage: powershell -File raw-print-escpos.ps1 -PrinterName "Xprinter XP-80" -Base64Data "<base64>"
# The printer must already exist as a Windows printer queue (Settings ->
# Printers & scanners) — this does NOT talk to the USB device directly, it
# still goes through the existing driver/queue, just with a RAW datatype
# job instead of a rendered document.

param(
    [Parameter(Mandatory = $true)][string]$PrinterName,
    [Parameter(Mandatory = $true)][string]$Base64Data
)

Add-Type @"
using System;
using System.Runtime.InteropServices;

public class RawPrinterHelper
{
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Ansi)]
    public class DOCINFOA
    {
        [MarshalAs(UnmanagedType.LPStr)] public string pDocName;
        [MarshalAs(UnmanagedType.LPStr)] public string pOutputFile;
        [MarshalAs(UnmanagedType.LPStr)] public string pDataType;
    }

    [DllImport("winspool.drv", EntryPoint = "OpenPrinterA", SetLastError = true, CharSet = CharSet.Ansi, ExactSpelling = true, CallingConvention = CallingConvention.StdCall)]
    public static extern bool OpenPrinter(string szPrinter, out IntPtr hPrinter, IntPtr pd);

    [DllImport("winspool.drv", EntryPoint = "ClosePrinter", SetLastError = true, ExactSpelling = true, CallingConvention = CallingConvention.StdCall)]
    public static extern bool ClosePrinter(IntPtr hPrinter);

    [DllImport("winspool.drv", EntryPoint = "StartDocPrinterA", SetLastError = true, CharSet = CharSet.Ansi, ExactSpelling = true, CallingConvention = CallingConvention.StdCall)]
    public static extern bool StartDocPrinter(IntPtr hPrinter, int level, [In] DOCINFOA di);

    [DllImport("winspool.drv", EntryPoint = "EndDocPrinter", SetLastError = true, ExactSpelling = true, CallingConvention = CallingConvention.StdCall)]
    public static extern bool EndDocPrinter(IntPtr hPrinter);

    [DllImport("winspool.drv", EntryPoint = "StartPagePrinter", SetLastError = true, ExactSpelling = true, CallingConvention = CallingConvention.StdCall)]
    public static extern bool StartPagePrinter(IntPtr hPrinter);

    [DllImport("winspool.drv", EntryPoint = "EndPagePrinter", SetLastError = true, ExactSpelling = true, CallingConvention = CallingConvention.StdCall)]
    public static extern bool EndPagePrinter(IntPtr hPrinter);

    [DllImport("winspool.drv", EntryPoint = "WritePrinter", SetLastError = true, ExactSpelling = true, CallingConvention = CallingConvention.StdCall)]
    public static extern bool WritePrinter(IntPtr hPrinter, byte[] pBytes, int dwCount, out int dwWritten);

    public static bool SendBytesToPrinter(string szPrinterName, byte[] data, out string errorDetail)
    {
        IntPtr hPrinter;
        DOCINFOA di = new DOCINFOA();
        bool success = false;
        errorDetail = "";
        di.pDocName = "KumonDB Raw Receipt";
        di.pDataType = "RAW";

        if (!OpenPrinter(szPrinterName, out hPrinter, IntPtr.Zero))
        {
            errorDetail = "OpenPrinter failed: Win32Error=" + Marshal.GetLastWin32Error();
            return false;
        }

        try
        {
            if (!StartDocPrinter(hPrinter, 1, di))
            {
                errorDetail = "StartDocPrinter failed: Win32Error=" + Marshal.GetLastWin32Error();
                return false;
            }

            try
            {
                if (!StartPagePrinter(hPrinter))
                {
                    errorDetail = "StartPagePrinter failed: Win32Error=" + Marshal.GetLastWin32Error();
                    return false;
                }

                int written;
                success = WritePrinter(hPrinter, data, data.Length, out written);
                if (!success)
                {
                    errorDetail = "WritePrinter failed: Win32Error=" + Marshal.GetLastWin32Error();
                }
                else if (written != data.Length)
                {
                    success = false;
                    errorDetail = "WritePrinter wrote " + written + " of " + data.Length + " bytes";
                }

                EndPagePrinter(hPrinter);
            }
            finally
            {
                EndDocPrinter(hPrinter);
            }
        }
        finally
        {
            ClosePrinter(hPrinter);
        }

        return success;
    }
}
"@

$bytes = [Convert]::FromBase64String($Base64Data)
$errorDetail = ""
$result = [RawPrinterHelper]::SendBytesToPrinter($PrinterName, $bytes, [ref]$errorDetail)

if ($result) {
    Write-Output "OK"
    exit 0
}
else {
    Write-Output "FAIL: $errorDetail"
    exit 1
}
