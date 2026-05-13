import { Router, type IRouter } from "express";
import healthRouter from "./health";
import okxRouter from "./okx";
import perpRouter from "./perp";
import aiRouter from "./ai";
import autoRouter from "./auto";

const router: IRouter = Router();

router.use(healthRouter);
router.use(okxRouter);
router.use(perpRouter);
router.use(aiRouter);
router.use(autoRouter);

export default router;
