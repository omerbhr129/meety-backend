const jwt = require('jsonwebtoken');
const User = require('../models/User');

class AuthError extends Error {
  constructor(message, code = 401) {
    super(message);
    this.name = 'AuthError';
    this.code = code;
  }
}

const auth = async (req, res, next) => {
  const startTime = Date.now();
  console.log('\n=== Auth Middleware ===');
  console.log('Request details:', {
    path: req.path,
    method: req.method,
    ip: req.ip,
    userAgent: req.headers['user-agent'],
    timestamp: new Date().toISOString()
  });
  
  try {
    // Get the authorization header
    const authHeader = req.header('Authorization');
    console.log('Auth header:', authHeader ? '[PRESENT]' : '[MISSING]');
    
    if (!authHeader) {
      // אם זה route ציבורי, נמשיך בלי אימות
      if (req.path === '/auth/login' || req.path === '/auth/register') {
        console.log('Skipping auth for public route');
        return next();
      }
      throw new AuthError('נדרשת התחברות למערכת');
    }

    // חילוץ הטוקן
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : authHeader;
    if (!token) {
      throw new AuthError('טוקן לא תקין');
    }
    
    // אימות הטוקן
    let decoded;
    try {
      decoded = jwt.verify(token, process.env.JWT_SECRET || 'your-secret-key');
    } catch (error) {
      if (error.name === 'TokenExpiredError') {
        throw new AuthError('פג תוקף החיבור, אנא התחבר מחדש');
      }
      throw new AuthError('טוקן לא תקין');
    }

    console.log('Token verified:', {
      userId: decoded.userId,
      email: decoded.email,
      exp: new Date(decoded.exp * 1000)
    });
    
    // מציאת המשתמש
    const user = await User.findById(decoded.userId);
    if (!user) {
      console.error('User not found:', decoded.userId);
      throw new AuthError('משתמש לא נמצא');
    }

    // בדיקת סטטוס המשתמש
    if (user.status === 'inactive' || user.status === 'deleted') {
      console.error('Inactive user:', {
        id: user._id,
        status: user.status
      });
      throw new AuthError('חשבון המשתמש אינו פעיל', 403);
    }

    // בדיקת תוקף הטוקן
    const tokenExp = new Date(decoded.exp * 1000);
    if (tokenExp <= new Date()) {
      throw new AuthError('פג תוקף החיבור, אנא התחבר מחדש');
    }

    // הוספת המשתמש לבקשה
    req.user = user;
    req.userId = user._id;

    // עדכון זמן התחברות אחרון
    user.lastLogin = new Date();
    await user.save();

    const duration = Date.now() - startTime;
    console.log('Auth completed:', {
      success: true,
      userId: user._id,
      duration: `${duration}ms`,
      timestamp: new Date().toISOString()
    });

    next();
  } catch (error) {
    const duration = Date.now() - startTime;
    console.error('Auth error:', {
      name: error.name,
      message: error.message,
      code: error.code,
      duration: `${duration}ms`,
      timestamp: new Date().toISOString()
    });

    res.status(error.code || 401).json({ 
      status: 'error',
      message: error.message || 'אנא התחבר מחדש'
    });
  }
};

module.exports = auth;
