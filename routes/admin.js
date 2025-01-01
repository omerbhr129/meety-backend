const express = require('express');
const router = express.Router();
const User = require('../models/User');
const Meeting = require('../models/Meeting');
const auth = require('../middlewares/auth');

// Mark notification as read
router.patch('/notifications/:id/read', auth, async (req, res) => {
  try {
    const { id } = req.params;
    
    // בדיקה אם זו התראה על פגישה שהושלמה
    if (id.includes('-')) {
      const [meetingId, slotId] = id.split('-');
      const meeting = await Meeting.findById(meetingId);
      if (meeting) {
        const slot = meeting.bookedSlots.id(slotId);
        if (slot) {
          slot.notificationRead = true;
          await meeting.save();
        }
      }
    } else {
      // בדיקה אם ההתראה היא על פגישה או משתמש
      const meeting = await Meeting.findById(id);
      if (meeting) {
        meeting.notificationRead = true;
        await meeting.save();
      } else {
        const user = await User.findById(id);
        if (user) {
          user.notificationRead = true;
          await user.save();
        }
      }
    }

    res.json({ success: true });
  } catch (error) {
    console.error('Error marking notification as read:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

// Get admin stats
router.get('/stats', auth, async (req, res) => {
  try {
    const users = await User.find().lean();
    const meetings = await Meeting.find()
      .populate('creator', 'fullName email')
      .populate('bookedSlots.participant', 'fullName email')
      .lean();
    const now = new Date();
    
    // משתמשים חדשים בשבוע האחרון
    const oneWeekAgo = new Date();
    oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);
    const twoWeeksAgo = new Date();
    twoWeeksAgo.setDate(twoWeeksAgo.getDate() - 14);

    const newUsersLastWeek = users.filter(user => 
      new Date(user.createdAt) > oneWeekAgo
    ).length;

    const newUsersTwoWeeksAgo = users.filter(user => 
      new Date(user.createdAt) > twoWeeksAgo && new Date(user.createdAt) <= oneWeekAgo
    ).length;

    const weeklyGrowth = newUsersTwoWeeksAgo ? 
      Math.round(((newUsersLastWeek - newUsersTwoWeeksAgo) / newUsersTwoWeeksAgo) * 100) : 0;

    // פגישות מתוכננות ושהושלמו
    const upcomingMeetings = meetings.reduce((count, meeting) => {
      const upcomingSlots = (meeting.bookedSlots || []).filter(slot => {
        const meetingDate = new Date(`${slot.date}T${slot.time}`);
        return meetingDate > now && slot.status !== 'deleted';
      });
      return count + upcomingSlots.length;
    }, 0);

    const completedMeetings = meetings.reduce((count, meeting) => {
      const completedSlots = (meeting.bookedSlots || []).filter(slot => 
        slot.status === 'completed'
      );
      return count + completedSlots.length;
    }, 0);

    // משתמשים פעילים ב-24 שעות האחרונות
    const last24Hours = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const activeUsers24h = users.filter(user => 
      user.lastLogin && new Date(user.lastLogin) > last24Hours
    ).length;

    // התראות מערכת
    const notifications = [
      // פגישות חדשות שנוצרו
      ...meetings.slice(-5).map(meeting => ({
        id: meeting._id.toString(),
        type: 'meeting_created',
        title: 'פגישה חדשה נוצרה',
        description: `נוצרה פגישה חדשה על ידי ${meeting.creator?.fullName || meeting.creator?.email || 'משתמש'}`,
        timestamp: meeting.createdAt,
        read: meeting.notificationRead || false
      })),
      // משתמשים חדשים שהצטרפו
      ...users.slice(-5).map(user => ({
        id: user._id.toString(),
        type: 'user_joined',
        title: 'משתמש חדש הצטרף',
        description: `${user.fullName || user.email} הצטרף למערכת`,
        timestamp: user.createdAt,
        read: user.notificationRead || false
      })),
      // פגישות שהושלמו
      ...meetings.flatMap(meeting => 
        (meeting.bookedSlots || [])
          .filter(slot => slot.status === 'completed' && !slot.notificationRead)
          .map(slot => ({
            id: `${meeting._id}-${slot._id}`,
            type: 'meeting_completed',
            title: 'פגישה הושלמה',
            description: `הפגישה "${meeting.title}" עם ${slot.participant?.fullName || slot.participant?.email || 'משתתף'} הושלמה`,
            timestamp: new Date(),
            read: false
          }))
      )
    ].sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());

    // רשימת משתמשים עם נתונים
    const usersList = await Promise.all(users.map(async (user) => {
      const userMeetings = await Meeting.find({ creator: user._id }).lean();
      const upcomingMeetingsCount = userMeetings.reduce((count, meeting) => {
        const upcomingSlots = (meeting.bookedSlots || []).filter(slot => {
          const meetingDate = new Date(`${slot.date}T${slot.time}`);
          return meetingDate > now && slot.status !== 'deleted';
        });
        return count + upcomingSlots.length;
      }, 0);

      return {
        id: user._id,
        fullName: user.fullName,
        email: user.email,
        lastLogin: user.lastLogin || user.createdAt,
        totalMeetings: userMeetings.reduce((count, meeting) => 
          count + (meeting.bookedSlots?.length || 0), 0
        ),
        upcomingMeetings: upcomingMeetingsCount
      };
    }));

    // חישוב ממוצע פגישות למשתמש
    const totalMeetingsCount = meetings.reduce((count, meeting) => 
      count + (meeting.bookedSlots?.length || 0), 0
    );
    const averageMeetingsPerUser = users.length ? 
      parseFloat((totalMeetingsCount / users.length).toFixed(1)) : 0;

    // סה"כ פגישות שנוצרו אי פעם (כולל מחוקות)
    const allMeetings = await Meeting.find({}).lean();
    const totalCreatedMeetings = allMeetings.reduce((total, meeting) => {
      return total + (meeting.bookedSlots?.length || 0);
    }, 0);

    res.json({
      users: {
        total: users.length,
        active: users.filter(user => user.status === 'active').length,
        lastRegistered: users.sort((a, b) => 
          new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
        )[0]?.createdAt,
        newLastWeek: newUsersLastWeek,
        weeklyGrowth
      },
      meetings: {
        total: totalMeetingsCount,
        upcoming: upcomingMeetings,
        completed: completedMeetings,
        totalCreated: totalCreatedMeetings // כל הפגישות שנוצרו אי פעם מתחילת המערכת
      },
      activity: {
        totalLogins: users.reduce((sum, user) => 
          sum + (user.totalLogins || 0), 0
        ),
        activeUsers24h,
        averageMeetingsPerUser
      },
      notifications,
      usersList
    });
  } catch (error) {
    console.error('Error fetching admin stats:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

module.exports = router;
