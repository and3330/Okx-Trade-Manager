import { Router, type IRouter } from "express";
import healthRouter from "./health";
import okxRouter from "./okx";
import aiRouter from "./ai";

const router: IRouter = Router();

router.use(healthRouter);
router.use(okxRouter);
router.use(aiRouter);

export default router;
