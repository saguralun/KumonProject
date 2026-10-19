import express from "express";
import { createSendError } from "./routeErrorHandler.js";
import {
    applyEnrollmentStatusAction,
    createEnrollment,
    createStudent,
    deleteEnrollmentIfNoBilling,
    deleteEnrollmentStatusEntry,
    deleteStudentIfNoEnrollment,
    findStudentDuplicate,
    getStudentHistory,
    getStudentHistoryRows,
    getStudentMasters,
    getStudentProfile,
    getStudentWsGraph,
    searchStudents,
    returnStudentCd,
    updateEnrollment,
    updateStudent
} from "../services/studentService.js";
import { requireAdmin, requireStaff } from "../middleware/auth.js";
import { previewKsisStudent } from "../services/ksisStudentService.js";

const router = express.Router();

const sendError = createSendError("Unexpected student manager error");

router.post("/ksis/preview", requireStaff, async (req, res) => {
    res.set("Cache-Control", "no-store");
    const address = req.socket.remoteAddress;
    if (!["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(address)) {
        return res.status(403).json({ success: false, error: "กรุณาใช้ฟังก์ชัน KSIS ผ่าน localhost บนเครื่องที่รัน KumonDB เพื่อเข้าสู่ระบบใน Chrome ของเครื่องนั้น" });
    }
    try {
        res.json({ success: true, ...(await previewKsisStudent({ url: req.body?.url, userId: req.session.user.userId })) });
    } catch (error) {
        sendError(res, error);
    }
});

router.get("/masters", async (req, res) => {
    try {
        res.json({
            success: true,
            masters: await getStudentMasters()
        });
    } catch (error) {
        sendError(res, error);
    }
});

router.get("/search", async (req, res) => {
    try {
        const rows = await searchStudents({
            query: req.query.query,
            status: req.query.status,
            limit: req.query.limit
        });

        res.json({
            success: true,
            rows
        });
    } catch (error) {
        sendError(res, error);
    }
});

router.get("/duplicate", async (req, res) => {
    try {
        res.json({
            success: true,
            duplicate: await findStudentDuplicate({
                firstName: req.query.firstName,
                lastName: req.query.lastName
            })
        });
    } catch (error) {
        sendError(res, error);
    }
});

router.get("/:studentId", async (req, res) => {
    try {
        res.json({
            success: true,
            ...(await getStudentProfile(req.params.studentId))
        });
    } catch (error) {
        sendError(res, error);
    }
});

router.get("/:studentId/history", async (req, res) => {
    try {
        res.json({
            success: true,
            ...(await getStudentHistoryRows({
                studentId: req.params.studentId,
                type: req.query.type,
                enrollmentId: req.query.enrollmentId
            }))
        });
    } catch (error) {
        sendError(res, error);
    }
});

router.get("/:studentId/ws-graph", async (req, res) => {
    try {
        res.json({
            success: true,
            ...(await getStudentWsGraph({
                studentId: req.params.studentId,
                enrollmentId: req.query.enrollmentId,
                range: req.query.range
            }))
        });
    } catch (error) {
        sendError(res, error);
    }
});

router.post("/", requireStaff, async (req, res) => {
    try {
        res.json({
            success: true,
            ...(await createStudent(req.body))
        });
    } catch (error) {
        sendError(res, error);
    }
});

router.put("/:studentId", requireStaff, async (req, res) => {
    try {
        res.json({
            success: true,
            ...(await updateStudent(req.params.studentId, req.body))
        });
    } catch (error) {
        sendError(res, error);
    }
});

router.delete("/:studentId", requireStaff, async (req, res) => {
    try {
        res.json({
            success: true,
            ...(await deleteStudentIfNoEnrollment(req.params.studentId))
        });
    } catch (error) {
        sendError(res, error);
    }
});

router.post("/:studentId/enrollments", requireStaff, async (req, res) => {
    try {
        res.json({
            success: true,
            ...(await createEnrollment(req.params.studentId, req.body))
        });
    } catch (error) {
        sendError(res, error);
    }
});

router.put("/:studentId/enrollments/:enrollmentId", requireStaff, async (req, res) => {
    try {
        res.json({
            success: true,
            ...(await updateEnrollment(
                req.params.studentId,
                req.params.enrollmentId,
                req.body
            ))
        });
    } catch (error) {
        sendError(res, error);
    }
});

router.delete("/:studentId/enrollments/:enrollmentId", requireStaff, async (req, res) => {
    try {
        res.json({
            success: true,
            ...(await deleteEnrollmentIfNoBilling(
                req.params.studentId,
                req.params.enrollmentId
            ))
        });
    } catch (error) {
        sendError(res, error);
    }
});

router.post("/:studentId/enrollments/:enrollmentId/status-action", requireStaff, async (req, res) => {
    try {
        res.json({
            success: true,
            ...(await applyEnrollmentStatusAction(
                req.params.studentId,
                req.params.enrollmentId,
                req.body
            ))
        });
    } catch (error) {
        sendError(res, error);
    }
});

router.delete("/:studentId/history/cd/:cdUsedId", requireStaff, async (req, res) => {
    try {
        res.json({ success: true, ...(await returnStudentCd(req.params.studentId, req.params.cdUsedId)) });
    } catch (error) {
        sendError(res, error);
    }
});

router.delete("/:studentId/history/status/:enrollmentStatusId", requireAdmin, async (req, res) => {
    try {
        res.json({
            success: true,
            ...(await deleteEnrollmentStatusEntry(
                req.params.studentId,
                req.params.enrollmentStatusId
            ))
        });
    } catch (error) {
        sendError(res, error);
    }
});

export default router;
