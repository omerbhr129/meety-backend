require('dotenv').config();
const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const User = require('./models/User');
const Meeting = require('./models/Meeting');
const Participant = require('./models/Participant');
const auth = require('./middlewares/auth');

const app = express();

// חיבור למונגו
console.log('Connecting to MongoDB...');
console.log('MONGODB_URI:', process.env.MONGODB_URI);

mongoose.connect(process.env.MONGODB_URI, {
  // אופטימיזציה לחיבור למונגו
  useNewUrlParser: true,
  useUnifiedTopology: true,
  autoIndex: true, // חשוב בשביל האינדקסים שהוספנו
}).then(() => {
  console.log('Connected to MongoDB');
}).catch(err => {
  console.error('MongoDB connection error:', err);
});

// הגדרות CORS מורחבות
app.use(cors({
  origin: true,
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'Accept', 'Accept-Language', 'Origin', 'User-Agent']
}));

app.use(express.json());

// Middleware לתיעוד בקשות
app.use((req, res, next) => {
  console.log(`=== ${new Date().toISOString()} ===`);
  console.log('Method:', req.method);
  console.log('URL:', req.url);
  console.log('Origin:', req.headers.origin);
  console.log('Headers:', req.headers);
  console.log('Body:', req.body);
  next();
});

// נתיב בדיקה
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'ok',
    timestamp: new Date().toISOString(),
    mongoStatus: mongoose.connection.readyState
  });
});

// התחברות
app.post('/api/login', async (req, res) => {
  try {
    console.log('Login attempt:', req.body);
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'חסרים פרטי התחברות' });
    }

    const user = await User.findOne({ email });
    if (!user) {
      console.log('User not found:', email);
      return res.status(401).json({ error: 'אימייל או סיסמה שגויים' });
    }

    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) {
      console.log('Invalid password for user:', email);
      return res.status(401).json({ error: 'אימייל או סיסמה שגויים' });
    }

    // Update last login time
    user.lastLogin = new Date();
    await user.save();

    console.log('User logged in successfully:', user._id);
    
    res.json({ 
      user: {
        _id: user._id,
        email: user.email,
        fullName: user.fullName
      }
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: error.message });
  }
});

// קבלת פרטי משתמש
app.get('/api/user/:userId', async (req, res) => {
  try {
    const user = await User.findById(req.params.userId);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    res.json({ 
      user: {
        _id: user._id,
        email: user.email,
        fullName: user.fullName
      }
    });
  } catch (error) {
    console.error('Error fetching user:', error);
    res.status(500).json({ error: error.message });
  }
});

// הרשמה
app.post('/api/register', async (req, res) => {
  try {
    console.log('Registration attempt:', req.body);
    const { email, password, fullName } = req.body;

    if (!email || !password || !fullName) {
      console.log('Missing registration details');
      return res.status(400).json({ error: 'חסרים פרטי הרשמה' });
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      console.log('Invalid email format:', email);
      return res.status(400).json({ error: 'כתובת אימייל לא תקינה' });
    }

    if (password.length < 6) {
      console.log('Password too short');
      return res.status(400).json({ error: 'הסיסמה חייבת להכיל לפחות 6 תווים' });
    }

    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(400).json({ error: 'משתמש עם אימייל זה כבר קיים' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const user = new User({
      email,
      password: hashedPassword,
      fullName,
      status: 'active'
    });

    await user.save();
    console.log('User registered successfully:', user._id);

    res.status(201).json({ 
      user: {
        _id: user._id,
        email: user.email,
        fullName: user.fullName
      }
    });
  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({ error: error.message });
  }
});

// יצירת פגישה חדשה
app.post('/api/meetings', async (req, res) => {
  try {
    console.log('Creating meeting with data:', req.body);
    const { userId, meetingName, duration, meetingType, availabilityType, workingHours, days } = req.body;

    // Validate user exists
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const meeting = new Meeting({
      title: meetingName,
      creator: userId,
      duration,
      type: meetingType,
      availability: {
        type: availabilityType,
        workingHours,
        days
      },
      status: 'active',
      bookedSlots: []
    });

    const savedMeeting = await meeting.save();
    console.log('Meeting created:', savedMeeting);

    res.status(201).json({ 
      meeting: savedMeeting,
      message: 'Meeting created successfully'
    });
  } catch (error) {
    console.error('Error creating meeting:', error);
    res.status(500).json({ error: error.message });
  }
});

// קבלת פגישה ספציפית
app.get('/api/meetings/:id', async (req, res) => {
  try {
    // אופטימיזציה: בחירת השדות הנדרשים בלבד
    const meeting = await Meeting.findById(req.params.id)
      .select('title duration type availability status bookedSlots')
      .lean();
      
    if (!meeting) {
      return res.status(404).json({ error: 'Meeting not found' });
    }
    res.json({ meeting });
  } catch (error) {
    console.error('Error fetching meeting:', error);
    res.status(500).json({ error: error.message });
  }
});

// קבלת פגישות של משתמש
app.get('/api/user/:userId/meetings', async (req, res) => {
  try {
    const userId = req.params.userId;
    console.log('Fetching meetings for user:', userId);
    
    // Validate user exists
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const meetings = await Meeting.find({ 
      creator: userId,
      status: { $ne: 'deleted' }
    }).sort({ createdAt: -1 });

    console.log('Found meetings:', meetings);
    res.json({ meetings });
  } catch (error) {
    console.error('Error fetching meetings:', error);
    res.status(500).json({ error: error.message });
  }
});

// עדכון פגישה
app.patch('/api/meetings/:id', async (req, res) => {
  try {
    const meetingId = req.params.id;
    const updateData = req.body;

    const meeting = await Meeting.findById(meetingId);
    if (!meeting) {
      return res.status(404).json({ error: 'Meeting not found' });
    }

    // Update only allowed fields
    const allowedUpdates = ['title', 'duration', 'type', 'availability', 'status'];
    Object.keys(updateData).forEach(key => {
      if (allowedUpdates.includes(key)) {
        meeting[key] = updateData[key];
      }
    });

    const updatedMeeting = await meeting.save();
    res.json({ meeting: updatedMeeting });
  } catch (error) {
    console.error('Error updating meeting:', error);
    res.status(500).json({ error: error.message });
  }
});

// הזמנת פגישה - עם אופטימיזציה
app.post('/api/meetings/:id/book', async (req, res) => {
  try {
    const { date, time, attendee } = req.body;
    
    // אופטימיזציה: שימוש ב-select לבחירת שדות ספציפיים
    const meeting = await Meeting.findById(req.params.id)
      .select('bookedSlots duration type status');
    
    if (!meeting) {
      return res.status(404).json({ error: 'Meeting not found' });
    }

    // בדיקת זמינות עם האינדקס החדש
    const isAvailable = meeting.isTimeSlotAvailable(date, time);
    if (!isAvailable) {
      return res.status(400).json({ error: 'השעה המבוקשת כבר תפוסה' });
    }

    // אופטימיזציה: שימוש ב-findOneAndUpdate במקום find + save
    const participant = await Participant.findOneAndUpdate(
      { email: attendee.email },
      {
        $setOnInsert: {
          fullName: attendee.name,
          email: attendee.email,
          phone: attendee.phone
        },
        $addToSet: { meetings: meeting._id },
        $set: { lastMeeting: new Date() }
      },
      { upsert: true, new: true }
    );

    // הוספת ההזמנה
    meeting.bookedSlots.push({
      date: new Date(date),
      time,
      attendee,
      status: 'pending'
    });

    await meeting.save();

    res.status(201).json({ 
      message: 'Meeting booked successfully',
      booking: {
        date,
        time,
        attendee: {
          name: attendee.name,
          email: attendee.email
        }
      }
    });
  } catch (error) {
    console.error('Error booking meeting:', error);
    res.status(500).json({ error: error.message });
  }
});

// בדיקת זמינות - עם אופטימיזציה
app.get('/api/meetings/:id/availability', async (req, res) => {
  try {
    const { date, time } = req.query;
    
    // אופטימיזציה: בחירת שדות ספציפיים בלבד
    const meeting = await Meeting.findById(req.params.id)
      .select('bookedSlots')
      .lean();
    
    if (!meeting) {
      return res.status(404).json({ error: 'Meeting not found' });
    }

    // בדיקת זמינות מהירה עם האינדקס החדש
    const requestedDate = new Date(date);
    requestedDate.setHours(0, 0, 0, 0);

    const isAvailable = !meeting.bookedSlots.some(slot => 
      slot.date.getTime() === requestedDate.getTime() &&
      slot.time === time &&
      slot.status !== 'cancelled'
    );

    res.json({ isAvailable });
  } catch (error) {
    console.error('Error checking availability:', error);
    res.status(500).json({ error: error.message });
  }
});

// מחיקת פגישה
app.delete('/api/meetings/:id', async (req, res) => {
  try {
    const meeting = await Meeting.findById(req.params.id);
    if (!meeting) {
      return res.status(404).json({ error: 'Meeting not found' });
    }

    // Soft delete
    meeting.status = 'deleted';
    await meeting.save();

    res.json({ message: 'Meeting deleted successfully' });
  } catch (error) {
    console.error('Error deleting meeting:', error);
    res.status(500).json({ error: error.message });
  }
});

// קבלת רשימת משתתפים
app.get('/api/participants', async (req, res) => {
  try {
    const participants = await Participant.find()
      .populate('meetings')
      .sort({ fullName: 1 });

    const formattedParticipants = participants.map(p => ({
      id: p._id,
      fullName: p.fullName,
      email: p.email,
      phone: p.phone,
      company: p.company,
      position: p.position,
      meetingsCount: p.meetings.length,
      lastMeeting: p.lastMeeting,
      profileImage: p.profileImage
    }));

    res.json(formattedParticipants);
  } catch (error) {
    console.error('Error fetching participants:', error);
    res.status(500).json({ error: error.message });
  }
});

// הוספת משתתף חדש
app.post('/api/participants', async (req, res) => {
  try {
    const participantData = req.body;
    const participant = new Participant(participantData);
    await participant.save();
    res.status(201).json(participant);
  } catch (error) {
    console.error('Error creating participant:', error);
    res.status(500).json({ error: error.message });
  }
});

// עדכון משתתף
app.patch('/api/participants/:id', async (req, res) => {
  try {
    const participant = await Participant.findByIdAndUpdate(
      req.params.id,
      req.body,
      { new: true, runValidators: true }
    );
    if (!participant) {
      return res.status(404).json({ error: 'Participant not found' });
    }
    res.json(participant);
  } catch (error) {
    console.error('Error updating participant:', error);
    res.status(500).json({ error: error.message });
  }
});

// מחיקת משתתף
app.delete('/api/participants/:id', async (req, res) => {
  try {
    const participant = await Participant.findByIdAndDelete(req.params.id);
    if (!participant) {
      return res.status(404).json({ error: 'Participant not found' });
    }
    res.json({ message: 'Participant deleted successfully' });
  } catch (error) {
    console.error('Error deleting participant:', error);
    res.status(500).json({ error: error.message });
  }
});

// שליחת הזמנה למשתתף
app.post('/api/participants/invite', async (req, res) => {
  try {
    const { email } = req.body;
    // כאן יש להוסיף לוגיקה לשליחת מייל הזמנה
    res.json({ message: 'Invitation sent successfully' });
  } catch (error) {
    console.error('Error sending invitation:', error);
    res.status(500).json({ error: error.message });
  }
});

// טיפול בנתיבים לא קיימים
app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// Middleware לטיפול בשגיאות
app.use((err, req, res, next) => {
  console.error('Error:', err);
  res.status(500).json({ error: err.message || 'Internal server error' });
});

// בסביבה מקומית נאזין לפורט, בפרודקשן נייצא את האפליקציה
if (process.env.NODE_ENV !== 'production') {
  const PORT = process.env.PORT || 5004;
  app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
  });
}

module.exports = app;
