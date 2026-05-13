import { Router, type IRouter } from "express";
import healthRouter from "./health";
import okxRouter from "./okx";

const router: IRouter = Router();

router.use(healthRouter);
router.use(okxRouter);

export default router;
