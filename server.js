require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const mongoSanitize = require('express-mongo-sanitize');
const helmet = require('helmet');
const xss = require('xss');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const User = require('./models/User');
const Meeting = require('./models/Meeting');
const Participant = require('./models/Participant');
const auth = require('./middlewares/auth');
const adminRoutes = require('./routes/admin');
const { OAuth2Client } = require('google-auth-library');
const { Resend } = require('resend');
const resend = new Resend('re_7RjurPbh_CQBwvNh97hkkUXoF2gob8sjA');


const app = express();
const PORT = process.env.PORT || 5004;
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key';
const baseUrl = process.env.NODE_ENV === 'production'
  ? 'https://meety-backend.vercel.app'
  : `http://localhost:${PORT}`;
const uploadsDir = path.join(__dirname, 'uploads');
const profilesDir = path.join(uploadsDir, 'profiles');

// Create uploads directories if they don't exist
[uploadsDir, profilesDir].forEach(dir => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
});


// Helper functions
const getUTCDayOfWeek = (dateStr) => {
  const date = new Date(dateStr);
  const localDay = date.getDay();

  console.log('Getting day of week:', {
    dateStr,
    localDay,
    localDayName: ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'][localDay],
    date: date.toISOString(),
    localDate: date.toString()
  });

  return localDay;
};

const parseTime = (timeStr) => {
  const [hours, minutes] = timeStr.split(':').map(Number);
  return hours * 60 + minutes;
};

const formatTime = (minutes) => {
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return `${hours.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}`;
};

const generateTimeSlots = (startTime, endTime, duration) => {
  const slots = [];
  const start = parseTime(startTime);
  const end = parseTime(endTime);

  for (let time = start; time + duration <= end; time += duration) {
    slots.push(formatTime(time));
  }

  return slots;
};

const client = new OAuth2Client(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  'postmessage'
);

const isTimeSlotAvailable = (time, dayAvailability, duration) => {
  if (!dayAvailability?.enabled || !Array.isArray(dayAvailability?.timeSlots)) {
    console.log('Basic availability check failed:', {
      enabled: dayAvailability?.enabled,
      hasTimeSlots: Array.isArray(dayAvailability?.timeSlots)
    });
    return false;
  }

  if (dayAvailability.timeSlots.length === 0) {
    console.log('No time slots available');
    return false;
  }

  const requestedTime = parseTime(time);

  const isAvailable = dayAvailability.timeSlots.some(slot => {
    const startTime = parseTime(slot.start);
    const endTime = parseTime(slot.end);

    const isWithinSlot = requestedTime >= startTime && (requestedTime + duration) <= endTime;
    console.log('Time slot check:', {
      requestedTime,
      startTime,
      endTime,
      duration,
      isWithinSlot,
      slot
    });

    return isWithinSlot;
  });

  console.log('Final availability check:', {
    time,
    requestedTime,
    duration,
    isAvailable,
    dayAvailability
  });

  return isAvailable;
};



const sharp = require('sharp');
const crypto = require('crypto');

// Configure multer for optimized image uploads
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB limit
    files: 1
  },
  fileFilter: (req, file, cb) => {
    const allowedTypes = ['image/jpeg', 'image/png', 'image/gif'];
    if (!allowedTypes.includes(file.mimetype)) {
      return cb(new Error('Invalid file type'), false);
    }
    cb(null, true);
  }
}).single('image');

// Helper function to clean up old profile image from MongoDB
const cleanupOldProfileImage = async (userId) => {
  try {
    const user = await User.findById(userId);
    if (user && user.profileImage) {
      user.profileImage = undefined;
      await user.save();
      console.log('Deleted old profile image from MongoDB for user:', userId);
    }
  } catch (error) {
    console.error('Error cleaning up old profile image:', error);
  }
};


// CORS configuration
const allowedOrigins = ['http://localhost:3000', 'http://localhost:3001', 'http://localhost:3002', 'http://localhost:3003', 'http://localhost:3004', 'https://meetyil.com', 'https://meety-omerbhr129s-projects.vercel.app', 'https://meety-git-main-omerbhr129s-projects.vercel.app'];

// הגדרות אבטחה בסיסיות
app.use(helmet({
  crossOriginResourcePolicy: false,
  crossOriginEmbedderPolicy: false,
  crossOriginOpenerPolicy: false,
  contentSecurityPolicy: false
}));

// CORS middleware
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (allowedOrigins.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, PATCH, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');
  res.setHeader('Access-Control-Allow-Credentials', 'true');

  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  next();
});

app.use(mongoSanitize()); // סניטציה של קלט MongoDB

// XSS Protection Middleware
app.use((req, res, next) => {
  if (req.body) {
    for (let key in req.body) {
      if (typeof req.body[key] === 'string') {
        req.body[key] = xss(req.body[key]);
      }
    }
  }
  next();
});

// הגדרות Rate Limiting
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 דקות
  max: 100, // מקסימום 100 בקשות לכל IP
  message: 'יותר מדי בקשות, אנא נסה שוב מאוחר יותר'
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 דקות
  max: 20, // מקסימום 20 ניסיונות
  message: 'יותר מדי ניסיונות התחברות, אנא נסה שוב בעוד 15 דקות'
});

const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // שעה
  max: 10, // מקסימום 10 ניסיונות
  message: 'יותר מדי ניסיונות הרשמה, אנא נסה שוב בעוד שעה'
});

// החלת Rate Limiting - רק על נתיבים ספציפיים
app.use('/auth/login', authLimiter);
app.use('/auth/register', registerLimiter);

// טיפול בשגיאות גלובלי
app.use((err, req, res, next) => {
  // לוג מפורט של השגיאה
  console.error('Error:', {
    name: err.name,
    message: err.message,
    stack: err.stack,
    timestamp: new Date().toISOString(),
    requestInfo: {
      method: req.method,
      url: req.url,
      body: req.body,
      params: req.params,
      query: req.query
    }
  });

  // טיפול בסוגי שגיאות שונים
  switch (err.name) {
    case 'ValidationError':
      return res.status(400).json({
        status: 'error',
        message: 'שגיאת ולידציה',
        details: err.errors
      });

    case 'MongoError':
    case 'MongoServerError':
      if (err.code === 11000) {
        return res.status(400).json({
          status: 'error',
          message: 'ערך זה כבר קיים במערכת'
        });
      }
      break;

    case 'TokenExpiredError':
      return res.status(401).json({
        status: 'error',
        message: 'פג תוקף החיבור, אנא התחבר מחדש'
      });

    case 'JsonWebTokenError':
      return res.status(401).json({
        status: 'error',
        message: 'טוקן לא תקין'
      });
  }

  // שגיאה כללית
  res.status(err.status || 500).json({
    status: 'error',
    message: err.message || 'שגיאה בשרת',
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
  });
});

// Body parser middleware
app.use((req, res, next) => {
  if (req.method === 'GET' || req.headers['content-type']?.includes('multipart/form-data')) {
    next();
  } else {
    express.json()(req, res, next);
  }
});

// Improved request logging
app.use((req, res, next) => {
  try {
    const startTime = Date.now();

    // Log request details
    console.log('\n=== New Request ===', {
      timestamp: new Date().toISOString(),
      method: req.method,
      url: req.url,
      headers: {
        ...req.headers,
        authorization: req.headers.authorization ? '[PRESENT]' : '[MISSING]'
      },
      ...(req.method !== 'GET' && { body: req.body }),
      query: req.query,
      ip: req.ip
    });

    // Log response details
    res.on('finish', () => {
      const duration = Date.now() - startTime;
      console.log('=== Response ===', {
        statusCode: res.statusCode,
        duration: `${duration}ms`,
        timestamp: new Date().toISOString()
      });
    });

    next();
  } catch (error) {
    console.error('Error in logging middleware:', {
      error: error.message,
      stack: error.stack,
      timestamp: new Date().toISOString()
    });
    next();
  }
});

// Public routes
app.get('/meetings/:idOrLink', async (req, res) => {
  try {
    const { idOrLink } = req.params;
    console.log('\nFetching meeting:', idOrLink);

    let meeting;
    try {
      // Try to find by ID first
      meeting = await Meeting.findById(idOrLink);
    } catch (err) {
      // If not found by ID, try to find by shareableLink
      meeting = await Meeting.findOne({ shareableLink: idOrLink });
    }

    console.log('Found meeting:', meeting);

    if (!meeting) {
      return res.status(404).json({ message: 'Meeting not found' });
    }

    res.json({ meeting });
  } catch (error) {
    console.error('Error fetching meeting:', error);
    res.status(500).json({ message: 'Error fetching meeting' });
  }
});

// Create participant
app.post('/participants', auth, express.json(), async (req, res) => {
  try {
    console.log('\nCreating participant with data:', req.body);
    const { name, email, phone } = req.body;

    if (!name || !email || !phone) {
      console.log('Missing required fields:', { name, email, phone });
      return res.status(400).json({
        message: 'Missing required fields',
        required: ['name', 'email', 'phone'],
        received: req.body
      });
    }

    let participant = await Participant.findOne({
      $or: [
        { email, creator: req.userId },
        { email, creator: { $exists: false } }
      ]
    });
    console.log('Existing participant:', participant);

    if (participant) {
      participant.fullName = name;
      participant.phone = phone;
      participant.creator = req.userId; // עדכון המשתמש שיצר את המשתתף
      try {
        await participant.save();
        console.log('Updated existing participant:', participant);
        return res.json({ participant });
      } catch (error) {
        console.error('Error updating participant:', error);
        return res.status(400).json({
          message: 'Error updating participant',
          error: error.message
        });
      }
    }

    participant = new Participant({
      fullName: name,
      email,
      phone,
      meetings: [],
      creator: req.userId
    });

    try {
      await participant.save();
      console.log('Created new participant:', participant);
      res.status(201).json({
        participant: {
          _id: participant._id.toString(),
          fullName: participant.fullName,
          email: participant.email,
          phone: participant.phone,
          meetings: participant.meetings.map(id => id.toString()),
          lastMeeting: participant.lastMeeting,
          createdAt: participant.createdAt,
          updatedAt: participant.updatedAt
        }
      });
    } catch (error) {
      console.error('Error saving participant:', error);
      res.status(400).json({
        message: 'Error creating participant',
        error: error.message
      });
    }
  } catch (error) {
    console.error('Error in participant creation:', error);
    res.status(500).json({
      message: 'Error creating participant',
      error: error.message
    });
  }
});

// Protected routes
app.get('/meetings', auth, async (req, res) => {
  try {
    console.log('Fetching meetings for user:', req.userId);
    const meetings = await Meeting.find({
      creator: req.userId
    })
      .populate({
        path: 'bookedSlots.participant',
        select: 'fullName email phone'
      })
      .populate('creator', 'fullName email')
      .lean()
      .exec();

    // Add type and duration to each booked slot
    const enhancedMeetings = meetings.map(meeting => ({
      ...meeting,
      bookedSlots: meeting.bookedSlots.map(slot => ({
        ...slot,
        type: meeting.type,
        duration: meeting.duration,
        title: meeting.title
      }))
    }));

    console.log('Enhanced meetings:', JSON.stringify(enhancedMeetings, null, 2));
    res.json({ meetings: enhancedMeetings });
  } catch (error) {
    console.error('Error fetching meetings:', error);
    res.status(500).json({ message: 'Error fetching meetings' });
  }
});

app.post('/meetings', auth, express.json(), async (req, res) => {
  try {
    console.log('Creating meeting with data:', req.body);
    const { title, duration, type, availability } = req.body;

    if (!title || !duration || !type || !availability) {
      console.log('Missing required fields:', { title, duration, type, availability });
      return res.status(400).json({
        message: 'Missing required fields',
        required: ['title', 'duration', 'type', 'availability'],
        received: req.body
      });
    }

    const meeting = new Meeting({
      title,
      duration,
      type,
      creator: req.userId,
      availability,
      bookedSlots: [],
      notificationRead: false
    });

    await meeting.save();
    console.log('Created meeting:', meeting);
    res.status(201).json({ meeting });
  } catch (error) {
    console.error('Error creating meeting:', error);
    res.status(500).json({
      message: 'Error creating meeting',
      error: error.message,
      stack: error.stack
    });
  }
});

app.put('/meetings/:id', auth, express.json(), async (req, res) => {
  try {
    console.log('Updating meeting:', {
      id: req.params.id,
      userId: req.userId,
      body: req.body
    });

    const { id } = req.params;
    const { title, duration, type, availability } = req.body;

    if (!title || !duration || !type || !availability) {
      return res.status(400).json({
        message: 'Missing required fields',
        required: ['title', 'duration', 'type', 'availability'],
        received: req.body
      });
    }

    const meeting = await Meeting.findById(id);
    console.log('Found meeting:', meeting);

    if (!meeting) {
      return res.status(404).json({ message: 'Meeting not found' });
    }

    if (meeting.creator.toString() !== req.userId.toString()) {
      console.log('Authorization failed:', {
        meetingUserId: meeting.userId,
        requestUserId: req.userId
      });
      return res.status(403).json({ message: 'Not authorized' });
    }

    const updatedAvailability = {};
    const days = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

    days.forEach(day => {
      updatedAvailability[day] = {
        enabled: availability[day]?.enabled ?? false,
        timeSlots: availability[day]?.timeSlots ?? []
      };
    });

    meeting.title = title;
    meeting.duration = duration;
    meeting.type = type;
    meeting.availability = updatedAvailability;

    await meeting.save();
    console.log('Updated meeting:', meeting);

    res.json({ meeting });
  } catch (error) {
    console.error('Error updating meeting:', error);
    res.status(500).json({
      message: 'Error updating meeting',
      error: error.message
    });
  }
});

// Update meeting slot
app.patch('/meetings/:meetingId/slots/:slotId', auth, async (req, res) => {
  try {
    const { meetingId, slotId } = req.params;
    const { date, time, participant } = req.body;

    console.log('Updating meeting slot:', {
      meetingId,
      slotId,
      date,
      time,
      participant,
      userId: req.userId
    });

    const meeting = await Meeting.findOne({
      _id: meetingId,
      creator: req.userId
    });

    if (!meeting) {
      return res.status(404).json({ error: 'Meeting not found' });
    }

    // Find the specific slot
    const slot = meeting.bookedSlots.id(slotId);
    if (!slot) {
      return res.status(404).json({ error: 'Slot not found' });
    }

    // Update the slot
    if (date) slot.date = date;
    if (time) slot.time = time;
    if (participant) slot.participant = participant;

    await meeting.save();

    // Return the updated meeting with populated participant data
    const updatedMeeting = await Meeting.findById(meetingId)
      .populate('bookedSlots.participant', 'fullName email phone');

    console.log('Updated meeting:', updatedMeeting);
    res.json({ meeting: updatedMeeting });
  } catch (error) {
    console.error('Error updating meeting slot:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Update meeting slot status
app.patch('/meetings/:meetingId/slots/:slotId/status', auth, async (req, res) => {
  try {
    const { meetingId, slotId } = req.params;
    const { status } = req.body;

    console.log('Updating meeting slot status:', {
      meetingId,
      slotId,
      status,
      userId: req.userId
    });

    if (!['completed', 'missed', 'pending', 'deleted'].includes(status)) {
      return res.status(400).json({ error: 'Invalid status' });
    }

    const meeting = await Meeting.findOne({
      _id: meetingId,
      creator: req.userId
    });

    if (!meeting) {
      return res.status(404).json({ error: 'Meeting not found' });
    }

    // Find the specific slot
    const slot = meeting.bookedSlots.id(slotId);
    if (!slot) {
      return res.status(404).json({ error: 'Slot not found' });
    }

    // Update the status and reset notification read flag
    slot.status = status;
    if (status === 'completed') {
      slot.notificationRead = false;
    }
    await meeting.save();

    // Return the updated meeting with populated participant data
    const updatedMeeting = await Meeting.findById(meetingId)
      .populate('bookedSlots.participant', 'fullName email phone');

    console.log('Updated meeting:', updatedMeeting);
    res.json({ meeting: updatedMeeting });
  } catch (error) {
    console.error('Error updating meeting slot status:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Delete meeting slot
app.delete('/meetings/:meetingId/slots/:slotId', auth, async (req, res) => {
  try {
    const { meetingId, slotId } = req.params;

    console.log('Deleting meeting slot:', {
      meetingId,
      slotId,
      userId: req.userId
    });

    const meeting = await Meeting.findOne({
      _id: meetingId,
      creator: req.userId
    });

    if (!meeting) {
      return res.status(404).json({ error: 'Meeting not found' });
    }

    // Find and remove the specific slot
    const slotIndex = meeting.bookedSlots.findIndex(slot => slot._id.toString() === slotId);
    if (slotIndex === -1) {
      return res.status(404).json({ error: 'Slot not found' });
    }

    meeting.bookedSlots.splice(slotIndex, 1);
    await meeting.save();

    // Return the updated meeting with populated participant data
    const updatedMeeting = await Meeting.findById(meetingId)
      .populate('bookedSlots.participant', 'fullName email phone');

    console.log('Updated meeting after slot deletion:', updatedMeeting);
    res.json({ meeting: updatedMeeting });
  } catch (error) {
    console.error('Error deleting meeting slot:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.delete('/meetings/:id', auth, async (req, res) => {
  try {
    const { id } = req.params;
    console.log('Deleting meeting:', id);

    const meeting = await Meeting.findById(id);

    if (!meeting) {
      return res.status(404).json({ message: 'Meeting not found' });
    }

    if (meeting.creator.toString() !== req.userId.toString()) {
      console.log('Authorization failed:', {
        meetingCreator: meeting.creator,
        requestUserId: req.userId
      });
      return res.status(403).json({ message: 'Not authorized' });
    }

    await meeting.deleteOne();
    console.log('Meeting deleted successfully');
    res.json({ message: 'Meeting deleted successfully' });
  } catch (error) {
    console.error('Error deleting meeting:', error);
    res.status(500).json({ message: 'Error deleting meeting' });
  }
});

app.get('/participants', auth, async (req, res) => {
  try {
    console.log('Fetching participants for user:', req.userId);

    // מצא את כל הפגישות של המשתמש
    const meetings = await Meeting.find({
      creator: new mongoose.Types.ObjectId(req.userId),
      status: 'active'
    });

    const meetingIds = meetings.map(meeting => meeting._id);

    // מצא את כל המשתתפים שנוצרו על ידי המשתמש
    const participants = await Participant.find({
      $or: [
        { meetings: { $in: meetingIds } }, // משתתפים עם פגישות
        { creator: req.userId } // משתתפים שנוצרו על ידי המשתמש
      ]
    });

    console.log('Found participants:', participants);
    res.json({ participants });
  } catch (error) {
    console.error('Error fetching participants:', error);
    res.status(500).json({ message: 'Error fetching participants' });
  }
});

app.put('/participants/:id', auth, async (req, res) => {
  try {
    const { id } = req.params;
    const { fullName, email, phone } = req.body;
    console.log('\nUpdating participant:', { id, fullName, email, phone });

    const participant = await Participant.findById(id);
    if (!participant) {
      console.log('Participant not found:', id);
      return res.status(404).json({ message: 'Participant not found' });
    }

    if (fullName) participant.fullName = fullName;
    if (email) participant.email = email;
    if (phone) participant.phone = phone;

    await participant.save();
    console.log('Updated participant:', participant);

    res.json({
      participant: {
        _id: participant._id.toString(),
        fullName: participant.fullName,
        email: participant.email,
        phone: participant.phone,
        meetings: participant.meetings.map(id => id.toString()),
        lastMeeting: participant.lastMeeting,
        createdAt: participant.createdAt,
        updatedAt: participant.updatedAt
      }
    });
  } catch (error) {
    console.error('Error updating participant:', error);
    res.status(500).json({
      message: 'Error updating participant',
      error: error.message
    });
  }
});

app.delete('/participants/:id', auth, async (req, res) => {
  try {
    const { id } = req.params;
    console.log('\nDeleting participant:', {
      id,
      userId: req.userId,
      headers: req.headers
    });

    const participant = await Participant.findById(id);
    if (!participant) {
      console.log('Participant not found:', id);
      return res.status(404).json({ message: 'Participant not found' });
    }

    console.log('Found participant:', participant);

    const updateResult = await Meeting.updateMany(
      { 'bookedSlots.participant': id },
      { $pull: { bookedSlots: { participant: id } } }
    );
    console.log('Updated meetings:', updateResult);

    const deleteResult = await participant.deleteOne();
    console.log('Delete result:', deleteResult);

    console.log('Participant deleted successfully');
    res.json({ message: 'Participant deleted successfully' });
  } catch (error) {
    console.error('Error deleting participant:', error);
    res.status(500).json({ message: 'Error deleting participant' });
  }
});

// Book meeting
app.post('/meetings/:id/book', express.json(), async (req, res) => {
  try {
    console.log('\n=== Booking Meeting Request ===');
    console.log('Request params:', req.params);
    console.log('Request body:', req.body);

    const { id } = req.params;
    const { date, time, participant } = req.body;

    if (!date || !time || !participant) {
      console.log('Missing required fields:', { date, time, participant });
      return res.status(400).json({
        message: 'Missing required fields',
        required: ['date', 'time', 'participant'],
        received: req.body
      });
    }

    let meeting;

    // Try to find by ID first
    try {
      meeting = await Meeting.findById(id);
    } catch (err) {
      // If not a valid ID, try to find by shareableLink
      meeting = await Meeting.findOne({ shareableLink: id });
    }
    console.log('Found meeting:', meeting);

    if (!meeting) {
      console.log('Meeting not found:', id);
      return res.status(404).json({ message: 'Meeting not found' });
    }

    const participantDoc = await Participant.findById(participant);
    if (!participantDoc) {
      console.log('Participant not found:', participant);
      return res.status(404).json({ message: 'Participant not found' });
    }
    console.log('Found participant:', participantDoc);

    const dayOfWeek = new Date(date).getDay();
    const dayName = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'][dayOfWeek];
    const dayAvailability = meeting.availability[dayName];

    if (!dayAvailability?.enabled) {
      return res.status(400).json({ message: 'היום הנבחר אינו זמין' });
    }

    const isTimeAvailable = dayAvailability.timeSlots.some(slot => {
      const [slotStartHour, slotStartMinute] = slot.start.split(':').map(Number);
      const [slotEndHour, slotEndMinute] = slot.end.split(':').map(Number);
      const [bookingHour, bookingMinute] = time.split(':').map(Number);

      const slotStartMinutes = slotStartHour * 60 + slotStartMinute;
      const slotEndMinutes = slotEndHour * 60 + slotEndMinute;
      const bookingMinutes = bookingHour * 60 + bookingMinute;

      return bookingMinutes >= slotStartMinutes &&
        (bookingMinutes + meeting.duration) <= slotEndMinutes;
    });

    if (!isTimeAvailable) {
      return res.status(400).json({ message: 'השעה הנבחרת אינה זמינה' });
    }

    const isSlotBooked = meeting.bookedSlots.some(slot =>
      slot.date === date && slot.time === time && slot.status !== 'deleted'
    );

    if (isSlotBooked) {
      return res.status(400).json({ message: 'השעה הנבחרת כבר תפוסה' });
    }

    // Check if meeting time has passed
    const meetingDateTime = new Date(`${date}T${time}`);
    const now = new Date();

    // Format date to YYYY-MM-DD
    const formattedDate = date.split('T')[0];

    const booking = {
      date: formattedDate,
      time,
      participant,
      status: meetingDateTime < now ? 'completed' : 'pending'
    };

    if (!meeting.bookedSlots) {
      meeting.bookedSlots = [];
    }

    meeting.bookedSlots.push(booking);
    await meeting.save();
    console.log('Added new booking:', booking);

    participantDoc.meetings.push(meeting._id);
    participantDoc.lastMeeting = new Date();
    await participantDoc.save();
    console.log('Updated participant:', participantDoc);

    res.json({ booking });
  } catch (error) {
    console.error('=== Error booking meeting ===');
    console.error('Full error:', error);
    console.error('Error details:', {
      message: error.message,
      stack: error.stack,
      code: error.code,
      name: error.name
    });
    res.status(500).json({
      message: 'Error booking meeting',
      error: error.message,
      details: error.errors
    });
  }
});

// Book single meeting
app.post('/meetings/:id/book-single', express.json(), async (req, res) => {
  try {
    console.log('\n=== Booking Single Meeting Request ===');
    console.log('Request params:', req.params);
    console.log('Request body:', req.body);

    const { id } = req.params;
    const { date, time, participant } = req.body;

    if (!date || !time || !participant) {
      console.log('Missing required fields:', { date, time, participant });
      return res.status(400).json({
        message: 'Missing required fields',
        required: ['date', 'time', 'participant'],
        received: req.body
      });
    }

    let meeting;

    // Try to find by ID first
    try {
      meeting = await Meeting.findById(id);
    } catch (err) {
      // If not a valid ID, try to find by shareableLink
      meeting = await Meeting.findOne({ shareableLink: id });
    }
    console.log('Found meeting:', meeting);

    if (!meeting) {
      console.log('Meeting not found:', id);
      return res.status(404).json({ message: 'Meeting not found' });
    }

    const participantDoc = await Participant.findById(participant);
    if (!participantDoc) {
      console.log('Participant not found:', participant);
      return res.status(404).json({ message: 'Participant not found' });
    }
    console.log('Found participant:', participantDoc);

    const dayOfWeek = new Date(date).getDay();
    const dayName = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'][dayOfWeek];
    const dayAvailability = meeting.availability[dayName];

    if (!dayAvailability?.enabled) {
      return res.status(400).json({ message: 'היום הנבחר אינו זמין' });
    }

    const isTimeAvailable = dayAvailability.timeSlots.some(slot => {
      const [slotStartHour, slotStartMinute] = slot.start.split(':').map(Number);
      const [slotEndHour, slotEndMinute] = slot.end.split(':').map(Number);
      const [bookingHour, bookingMinute] = time.split(':').map(Number);

      const slotStartMinutes = slotStartHour * 60 + slotStartMinute;
      const slotEndMinutes = slotEndHour * 60 + slotEndMinute;
      const bookingMinutes = bookingHour * 60 + bookingMinute;

      return bookingMinutes >= slotStartMinutes &&
        (bookingMinutes + meeting.duration) <= slotEndMinutes;
    });

    if (!isTimeAvailable) {
      return res.status(400).json({ message: 'השעה הנבחרת אינה זמינה' });
    }

    const isSlotBooked = meeting.bookedSlots.some(slot =>
      slot.date === date && slot.time === time
    );

    if (isSlotBooked) {
      return res.status(400).json({ message: 'השעה הנבחרת כבר תפוסה' });
    }

    // Check if meeting time has passed
    const meetingDateTime = new Date(`${date}T${time}`);
    const now = new Date();

    const booking = {
      date,
      time,
      participant,
      status: meetingDateTime < now ? 'completed' : 'pending'
    };

    if (!meeting.bookedSlots) {
      meeting.bookedSlots = [];
    }

    meeting.bookedSlots.push(booking);
    await meeting.save();
    console.log('Added new booking:', booking);

    participantDoc.meetings.push(meeting._id);
    participantDoc.lastMeeting = new Date();
    await participantDoc.save();
    console.log('Updated participant:', participantDoc);

    res.json({ booking });
  } catch (error) {
    console.error('=== Error booking meeting ===');
    console.error('Full error:', error);
    console.error('Error details:', {
      message: error.message,
      stack: error.stack,
      code: error.code,
      name: error.name
    });
    res.status(500).json({
      message: 'Error booking meeting',
      error: error.message,
      details: error.errors
    });
  }
});

// Routes
app.use('/admin', adminRoutes);

// Auth routes
app.post('/auth/register', express.json(), async (req, res) => {
  try {
    const { email, password, fullName } = req.body;
    console.log('Registration attempt:', { email, fullName });

    if (!email || !password || !fullName) {
      return res.status(400).json({ message: 'כל השדות הם חובה' });
    }

    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(400).json({ message: 'משתמש עם אימייל זה כבר קיים במערכת' });
    }

    const user = new User({
      email,
      password,
      fullName,
      role: 'user',
      status: 'active',
      notificationRead: false,
      isEmailVerified: false
    });

    // Generate OTP
    const otp = user.generateOTP();
    await user.save();

    console.log('OTP:', otp);

    // Send OTP email
    try {
      console.log('Attempting to send OTP email:', {
        to: user.email,
        otp: otp,
        timestamp: new Date().toISOString()
      });

      const emailResponse = await resend.emails.send({
        from: 'onboarding@meetyil.com',
        to: user.email,
        subject: 'קוד אימות - Meety',
        html: `
          <div dir="rtl" style="font-family: Arial, sans-serif;">
            <h2>ברוכים הבאים ל-Meety!</h2>
            <p>קוד האימות שלך הוא:</p>
            <h1 style="font-size: 32px; letter-spacing: 5px; text-align: center; padding: 20px; background-color: #f5f5f5; border-radius: 5px;">${otp}</h1>
            <p>הקוד תקף ל-10 דקות בלבד.</p>
            <p>אם לא ביקשת להירשם לשירות, אנא התעלם מהודעה זו.</p>
          </div>
        `
      });

      console.log('Email sent successfully:', {
        response: emailResponse,
        timestamp: new Date().toISOString()
      });

    } catch (emailError) {
      console.error('Failed to send OTP email:', {
        error: emailError.message,
        stack: emailError.stack,
        timestamp: new Date().toISOString(),
        user: {
          email: user.email,
          id: user._id
        }
      });
      
      // Re-throw the error to be handled by the outer try-catch
      throw new Error(`Failed to send verification email: ${emailError.message}`);
    }

    res.status(201).json({
      message: 'נרשמת בהצלחה! קוד אימות נשלח לכתובת האימייל שלך.',
      userId: user._id
    });
  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({ message: 'שגיאה בהרשמה למערכת. אנא נסה שנית.' });
  }
});

app.post('/auth/login', express.json(), async (req, res) => {
  try {
    const { email, password } = req.body;
    console.log('Login attempt:', { email });

    const user = await User.findOne({ email });
    if (!user) {
      console.log('User not found:', email);
      return res.status(401).json({ message: 'משתמש לא קיים במערכת. אנא הירשם תחילה.' });
    }

    // Check if email is verified for manual registrations
    if (!user.googleId && !user.isEmailVerified) {
      return res.status(200).json({
        message: 'אנא אמת את כתובת האימייל שלך לפני ההתחברות',
        needsVerification: true,
        userId: user._id
      });
    }

    const isValidPassword = await user.comparePassword(password);
    if (!isValidPassword) {
      console.log('Invalid password for user:', email);
      return res.status(401).json({ message: 'סיסמה שגויה. אנא נסה שנית.' });
    }

    const token = jwt.sign(
      { userId: user._id, email: user.email },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.json({
      token,
      user: {
        _id: user._id,
        email: user.email,
        fullName: user.fullName,
        profileImage: user.profileImage,
        createdAt: user.createdAt,
        updatedAt: user.updatedAt
      }
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ message: 'שגיאה בהתחברות למערכת. אנא נסה שנית.' });
  }
});

app.post('/auth/google', express.json(), async (req, res) => {
  try {
    const { token } = req.body;
    console.log('Google login attempt:', { token });
    
    // Verify Google token
    const ticket = await client.verifyIdToken({
      idToken: token,
      audience: process.env.GOOGLE_CLIENT_ID
    });

    const { email, name, picture } = ticket.getPayload();

    // Check if user exists
    let user = await User.findOne({ email });

    if (!user) {
      // Create new user if doesn't exist
      user = await User.create({
        email,
        fullName: name,
        profileImage: picture,
        googleId: ticket.getUserId(),
        password: jwt.sign({ date: Date.now() }, process.env.JWT_SECRET), // random secure password
        isEmailVerified: true, // Automatically verify Google users
        status: 'active'
      });
    } else {
      // Update existing user's Google information
      user.googleId = ticket.getUserId();
      user.isEmailVerified = true; // Ensure email is verified
      if (!user.profileImage) user.profileImage = picture;
      await user.save();
    }

    // Generate JWT token
    const authToken = jwt.sign(
      { userId: user._id, email: user.email },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );

    // Return user and token
    res.json({
      token: authToken,
      user: {
        _id: user._id,
        email: user.email,
        fullName: user.fullName,
        profileImage: user.profileImage,
        isEmailVerified: user.isEmailVerified,
        createdAt: user.createdAt,
        updatedAt: user.updatedAt
      }
    });
  } catch (error) {
    console.error('Google login error:', error);
    res.status(500).json({ message: 'שגיאה בהתחברות עם Google. אנא נסה שנית.' });
  }
});

// User routes
// Admin routes
app.get('/admin/stats', auth, async (req, res) => {
  try {
    const user = await User.findById(req.userId);
    if (!user || user.role !== 'admin') {
      return res.status(401).json({ message: 'גישה לא מורשית' });
    }

    // Get users stats
    const totalUsers = await User.countDocuments();
    const activeUsers = await User.countDocuments({ status: 'active' });
    const lastRegistered = await User.findOne().sort({ createdAt: -1 }).select('createdAt');

    // Get meetings stats
    const totalMeetings = await Meeting.countDocuments();
    const upcomingMeetings = await Meeting.countDocuments({
      'bookedSlots.date': { $gte: new Date().toISOString().split('T')[0] },
      'bookedSlots.status': 'pending'
    });
    const completedMeetings = await Meeting.countDocuments({
      'bookedSlots.status': 'completed'
    });

    // Get activity stats
    const last24Hours = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const activeUsers24h = await User.countDocuments({
      lastLogin: { $gte: last24Hours }
    });

    // Get users list with meetings count
    const usersList = await User.find()
      .select('fullName email lastLogin')
      .lean();

    for (let user of usersList) {
      const userMeetings = await Meeting.find({ creator: user._id });
      user.totalMeetings = userMeetings.reduce((acc, meeting) => acc + meeting.bookedSlots.length, 0);
      user.upcomingMeetings = userMeetings.reduce((acc, meeting) =>
        acc + meeting.bookedSlots.filter(slot =>
          slot.date >= new Date().toISOString().split('T')[0] &&
          slot.status === 'pending'
        ).length, 0);
    }

    const stats = {
      users: {
        total: totalUsers,
        active: activeUsers,
        lastRegistered: lastRegistered?.createdAt
      },
      meetings: {
        total: totalMeetings,
        upcoming: upcomingMeetings,
        completed: completedMeetings
      },
      activity: {
        totalLogins: 0, // נוסיף בהמשך
        activeUsers24h,
        averageMeetingsPerUser: totalMeetings / (totalUsers || 1)
      },
      usersList: usersList.map(user => ({
        id: user._id,
        fullName: user.fullName,
        email: user.email,
        lastLogin: user.lastLogin,
        totalMeetings: user.totalMeetings,
        upcomingMeetings: user.upcomingMeetings
      }))
    };

    res.json(stats);
  } catch (error) {
    console.error('Error fetching admin stats:', error);
    res.status(500).json({ message: 'שגיאה בטעינת נתוני מנהל' });
  }
});

app.get('/user', auth, async (req, res) => {
  try {
    const user = await User.findById(req.userId);
    if (!user) {
      return res.status(404).json({ message: 'משתמש לא נמצא' });
    }

    // Let toJSON method handle the profile image URL
    res.json({ user });
  } catch (error) {
    console.error('Error fetching user:', error);
    res.status(500).json({ message: 'שגיאה בטעינת פרטי המשתמש' });
  }
});

app.put('/user', auth, async (req, res) => {
  try {
    const { fullName, email, currentPassword, newPassword } = req.body;

    const user = await User.findById(req.userId);
    if (!user) {
      return res.status(404).json({ message: 'משתמש לא נמצא' });
    }

    if (fullName) user.fullName = fullName;
    if (email) user.email = email;

    // אם נשלח אובייקט ריק, מחק את תמונת הפרופיל

    if (currentPassword && newPassword) {
      const isValidPassword = await user.comparePassword(currentPassword);
      if (!isValidPassword) {
        return res.status(400).json({ message: 'סיסמה נוכחית שגויה' });
      }
      user.password = newPassword;
    }

    await user.save();

    res.json({
      user: user.toJSON()
    });
  } catch (error) {
    console.error('Error updating user:', error);
    res.status(500).json({ message: 'Error updating user' });
  }
});

// Optimized profile image upload endpoint
// העלאת תמונת פרופיל
app.post('/user/profile-image', auth, async (req, res) => {
  try {
    console.log('Starting profile image upload for user:', req.userId);

    await new Promise((resolve, reject) => {
      upload(req, res, (err) => {
        if (err) {
          console.error('Multer upload error:', err);
          reject(err);
          return;
        }
        resolve();
      });
    });

    if (!req.file) {
      console.error('No file uploaded');
      return res.status(400).json({ message: 'לא נבחר קובץ להעלאה' });
    }

    console.log('File upload successful:', {
      originalname: req.file.originalname,
      mimetype: req.file.mimetype,
      size: req.file.size
    });

    const user = await User.findById(req.userId);
    if (!user) {
      console.error('User not found:', req.userId);
      return res.status(404).json({ message: 'User not found' });
    }

    // עיבוד התמונה עם sharp
    const processedImageBuffer = await sharp(req.file.buffer)
      .rotate() // שומר על ה-orientation המקורי
      .resize(400, 400, {
        fit: 'cover',
        position: 'center',
        withoutEnlargement: true,
        fastShrinkOnLoad: true
      })
      .webp({
        quality: 95,
        effort: 6,
        force: true,
        lossless: true
      })
      .toBuffer();

    // שמירת התמונה בבסיס הנתונים
    user.profileImage = {
      data: processedImageBuffer,
      contentType: 'image/webp'
    };

    await user.save();
    console.log('User profile image updated in database');

    res.json({
      user: {
        ...user.toJSON(),
        profileImage: `${baseUrl}/api/user/${user._id}/profile-image?t=${Date.now()}`
      }
    });

  } catch (error) {
    console.error('Error uploading profile image:', error);
    res.status(500).json({
      message: 'Error uploading profile image',
      error: error.message
    });
  }
});

// הצגת תמונת פרופיל
app.get('/api/user/:userId/profile-image', async (req, res) => {
  try {
    const user = await User.findById(req.params.userId);
    if (!user || !user.profileImage || !user.profileImage.data) {
      return res.status(404).send();
    }

    // Add CORS headers
    res.set({
      'Content-Type': user.profileImage.contentType,
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Cross-Origin-Resource-Policy': 'cross-origin'
    });

    res.send(user.profileImage.data);
  } catch (error) {
    console.error('Error serving profile image:', error);
    res.status(500).send();
  }
});

app.delete('/user', auth, async (req, res) => {
  try {
    const user = await User.findById(req.userId);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }


    // Delete user's meetings
    await Meeting.deleteMany({ creator: req.userId });

    // Delete user
    await user.deleteOne();

    res.json({ message: 'User account deleted successfully' });
  } catch (error) {
    console.error('Error deleting user:', error);
    res.status(500).json({ message: 'Error deleting user' });
  }
});

// Add OTP verification route
app.post('/auth/verify-otp', express.json(), async (req, res) => {
  try {
    const { userId, otp } = req.body;

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ message: 'משתמש לא נמצא' });
    }

    try {
      user.verifyOTP(otp);
    } catch (error) {
      await user.save(); // Save increased attempts count
      return res.status(400).json({ message: error.message });
    }

    // OTP is valid - verify user and cleanup OTP data
    user.isEmailVerified = true;
    user.otp = {
      code: null,
      expiresAt: null,
      attempts: 0
    };
    await user.save();

    // Generate JWT token
    const token = jwt.sign(
      { userId: user._id, email: user.email },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.json({
      message: 'האימייל אומת בהצלחה!',
      token,
      user: user.toJSON()
    });
  } catch (error) {
    console.error('OTP verification error:', error);
    res.status(500).json({ message: 'שגיאה באימות הקוד. אנא נסה שנית.' });
  }
});

// Add resend OTP route
app.post('/auth/resend-otp', express.json(), async (req, res) => {
  try {
    const { userId } = req.body;

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ message: 'משתמש לא נמצא' });
    }

    if (user.isEmailVerified) {
      return res.status(400).json({ message: 'האימייל כבר אומת' });
    }

    // Generate new OTP
    const otp = user.generateOTP();
    await user.save();

    // Send new OTP email
    await resend.emails.send({
      from: 'onboarding@meetyil.com',
      to: user.email,
      subject: 'קוד אימות חדש - Meety',
      html: `
        <div dir="rtl" style="font-family: Arial, sans-serif;">
          <h2>קוד אימות חדש</h2>
          <p>קוד האימות החדש שלך הוא:</p>
          <h1 style="font-size: 32px; letter-spacing: 5px; text-align: center; padding: 20px; background-color: #f5f5f5; border-radius: 5px;">${otp}</h1>
          <p>הקוד תקף ל-10 דקות בלבד.</p>
        </div>
      `
    });

    res.json({ message: 'קוד אימות חדש נשלח לכתובת האימייל שלך' });
  } catch (error) {
    console.error('Resend OTP error:', error);
    res.status(500).json({ message: 'שגיאה בשליחת הקוד החדש. אנא נסה שנית.' });
  }
});

// Connect to MongoDB with retry mechanism
const connectWithRetry = async (retries = 5, delay = 5000) => {
  try {
    await mongoose.connect(process.env.MONGODB_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
      serverSelectionTimeoutMS: 5000,
      // אפשרויות נוספות לחיבור יציב
      socketTimeoutMS: 45000,
      keepAlive: true,
      keepAliveInitialDelay: 300000
    });
    console.log('Connected to MongoDB successfully');
  } catch (err) {
    console.error('MongoDB connection error:', {
      error: err.message,
      timestamp: new Date().toISOString(),
      retries: retries
    });

    if (retries === 0) {
      console.error('Failed to connect to MongoDB after all retries');
      process.exit(1);
    }

    console.log(`Retrying connection in ${delay / 1000} seconds... (${retries} retries left)`);
    setTimeout(() => connectWithRetry(retries - 1, delay * 2), delay);
  }
};

// Handle MongoDB disconnection
mongoose.connection.on('disconnected', () => {
  console.log('MongoDB disconnected! Attempting to reconnect...');
  connectWithRetry();
});

mongoose.connection.on('error', (err) => {
  console.error('MongoDB connection error:', err);
  mongoose.disconnect();
});

// Start server after successful MongoDB connection
connectWithRetry().then(() => {
  app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
  });
});

// Update profile image URL
app.put('/user/profile-image', auth, express.json(), async (req, res) => {
  try {
    const { imageUrl } = req.body;

    console.log('Updating profile image URL:', {
      userId: req.userId,
      imageUrl
    });

    if (!imageUrl) {
      return res.status(400).json({
        message: 'Image URL is required'
      });
    }

    // Validate URL format
    try {
      new URL(imageUrl);
    } catch (error) {
      return res.status(400).json({
        message: 'Invalid image URL format'
      });
    }

    const user = await User.findById(req.userId);
    if (!user) {
      return res.status(404).json({
        message: 'User not found'
      });
    }

    user.profileImage = imageUrl;
    await user.save();

    console.log('Profile image URL updated successfully');

    res.json({
      user: user.toJSON()
    });

  } catch (error) {
    console.error('Error updating profile image URL:', error);
    res.status(500).json({
      message: 'Error updating profile image URL',
      error: error.message
    });
  }
});
