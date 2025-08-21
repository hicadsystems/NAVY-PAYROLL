const express = require('express');
const router = express.Router();
const { getOvertimeRates, saveOvertimeRate, getSalaryGroups, saveSalaryGroup, updateSalaryGroup, deleteSalaryGroup,
  getElementTypes,
  getGradeLevels,
  getSalaryScales, saveSalaryScale, updateSalaryScale, deleteSalaryScale } = require('./refrence-tables');
const jwt = require('jsonwebtoken');
const SECRET = process.env.JWT_SECRET;

// Token verification middleware
const verifyToken = (req, res, next) => {
  const bearerHeader = req.headers['authorization'];

  if (!bearerHeader) {
    return res.status(403).json({ message: 'No token provided' });
  }

  const token = bearerHeader.split(' ')[1]; // Removes "Bearer " part

  jwt.verify(token, SECRET, (err, decoded) => {
    if (err) {
      return res.status(401).json({ message: 'Failed to authenticate token' });
    }

    req.adminId = decoded.id; //Attach to request
    next();
  });
};

router.get('/overtime', async (req, res) => {
  res.json(await getOvertimeRates());
});

router.post('/overtime', express.json(), async (req, res) => {
  try {
    const result = await saveOvertimeRate(req.body);
    res.json({ success: true, result });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, error: err.message });
  }
});


/* -------- Salary Groups -------- */
router.get("/salary-groups", async (req, res) => {
  try { res.json(await getSalaryGroups()); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

router.post("/salary-groups", async (req, res) => {
  try { await saveSalaryGroup(req.body); res.json({ success: true }); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

router.put("/salary-groups/:id", async (req, res) => {
  try { await updateSalaryGroup({ ...req.body, groupcode: req.params.id }); res.json({ success: true }); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete("/salary-groups/:id", async (req, res) => {
  try { await deleteSalaryGroup(req.params.id); res.json({ success: true }); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

/* -------- Element Types -------- */
router.get("/element-types", async (req, res) => {
  try { res.json(await getElementTypes()); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

/* -------- Grade Levels -------- */
router.get("/grade-levels", async (req, res) => {
  try { res.json(await getGradeLevels()); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

/* -------- Salary Scale -------- */
router.get("/salary-scales", async (req, res) => {
  try { res.json(await getSalaryScales()); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

router.post("/salary-scales", async (req, res) => {
  try { await saveSalaryScale(req.body); res.json({ success: true }); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

router.put("/salary-scales/:id", async (req, res) => {
  try { await updateSalaryScale({ ...req.body, salcode: req.params.id }); res.json({ success: true }); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete("/salary-scales/:id", async (req, res) => {
  try { await deleteSalaryScale(req.params.id); res.json({ success: true }); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;