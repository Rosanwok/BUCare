const Chats = require('./../models/chat');
const Users = require('./../models/user');
const Rooms = require('./../models/room');
const Therapists = require('./../models/therapist');
const Clients = require('./../models/client');

// Initialize Packages
const Router = require('express').Router();
const Io = require("./../main");
const Joi = require('@hapi/joi');

// verification route
const verify = require('./auths/verify');

const chatSchema = Joi.object({
    RoomId: Joi.string().required(),
    SpokesPerson: Joi.string().required(),
    Message: Joi.string().required()
});

Router.get('/rooms', verify, (req, res) => {
    
    console.log(`Request made to : c${req.url}`);

    Io.on('connection', (socket) => {

        // Io tags the on('connection') event to itself with a callback containing the connected socket so for every new socket that connects it 
        // attaches the connection event multiple time and fires again for all the old ones and the new ones. So i kill the event after it has finished below
    
        socket.join(req.user._id.toString()); // rooms have to be strings
            
        if (socket.rooms.has(req.user._id.toString())) {
            Io.to(socket.id).emit("ack_rooms", "success");
        } else {
            Io.to(socket.id).emit("ack_rooms", "failed");
        }

        // this code alerts all users that this person is now online
        const nowOnline = () => {

            // get all rooms that this person participates in
            Rooms.find({ ClientId: req.user._id })
            .then(async room_docs => {
                for (let index = 0; index < room_docs.length; index++) {
                    const room = room_docs[index];
                    socket.to(room.TherapistId).emit('isOnline', room._id);
                }
            })
            .catch(err => {
                if (err) console.log(err);
            })

        }

        nowOnline();

        socket.on('chat_message', async function (data) {

            var { errors } = await chatSchema.validateAsync(data);

            if (errors) {

                // i dont think you can modify the headers again this may not be correct

                return res.status(400).send(errors.details[0].message);
            } else {

                var newMsg = Chats(data).save((err, chat_docs) => {

                    if (err) {
                        console.log(err);
                    } else {

                        Rooms.findOne({ _id: data.RoomId })
                            .then(room_docs => {

                                if ( room_docs.TherapistId == data.SpokesPerson ) {
                                    data.reciever = room_docs.ClientId;
                                } else {
                                    data.reciever = room_docs.TherapistId;
                                }

                                data.ChatId = chat_docs._id;

                                socket.to(data.reciever).emit('msg', data);
                            })
                            .catch(err => {
                                console.log(err);
                            })

                    }

                });

            }

        })

        socket.on("message_status", (data) => {
            
            Chats.findByIdAndUpdate(data.ChatId.toString(), { Status: data.status })
                .then(docs => {
                    // emit an event so you can update the ui to show the message has been deleivered
                    socket.to(data.SpokesPerson).emit('delivered');
                })
                .catch(err => {
                    console.log(err);
                })
    
        })

        socket.on('deliver_all', function (userId) {
            // get all rooms that this person participates in and then every chat where he is not the spokes man
            Rooms.find({ ClientId: userId })
                .then(async docs => {

                    const loop = async _ => {

                        for (let index = 0; index < docs.length; index++) {
                            const room = docs[index];
                            
                            const roomId = room._id;
                            // $ne means not equal to
                            
                            await Chats.updateMany({ RoomId: roomId, SpokesPerson: {$ne: userId}, Status: {$ne: 'delivered', $ne: 'seen'} }, {Status: 'delivered'})
                                .then(chat_docs => {
                                    // modifiedCount holds the number of chats it modified

                                    if (chat_docs.modifiedCount != 0) {

                                        // i send back a message for the frontend to update the ui
                                        // even if the person is offline it doesnt matter i still updated the db
                                        socket.to(room.TherapistId).emit("seen_all_completed", roomId);
                                    }

                                })
                                .catch(err => {
                                    if (err) console.log(err);
                                })
                        }

                    };

                    await loop();
                    
                })
                .catch(err => {
                    if (err) console.log(err);
                })
        })

        socket.on('seen_all_in_room', function (userId, roomId) {
            // get all rooms that this person participates in and then every chat where he is not the spokes man
            Rooms.find({ ClientId: userId })
                .then(async docs => {

                    const loop = async _ => {

                        for (let index = 0; index < docs.length; index++) {
                            const room = docs[index];
                            
                            const roomId = room._id;
                            // $ne means not equal to
                            await Chats.updateMany({ RoomId: roomId, SpokesPerson: {$ne: userId}, Status: {$ne: 'seen'} }, {Status: 'seen'})
                                .then(chat_docs => {

                                    if (chat_docs.modifiedCount != 0) {
                                        // i send back a message for the frontend to update the ui
                                        // even if the person is offline it doesnt matter i still updated the db
                                        socket.to(room.TherapistId).emit("seen_all_completed", roomId);
                                    }
                                    
                                })
                                .catch(err => {
                                    if (err) console.log(err);
                                })
                        }

                    };

                    await loop();
                    
                })
                .catch(err => {
                    if (err) console.log(err);
                })
        });

        socket.on('left_room', function (roomId) {
            Rooms.findById(roomId)
                .then(room_docs => {
                    socket.to(room_docs.TherapistId).emit('disbanded_room', roomId);
                })
                .catch(err => {
                    if (err) console.log(err);
                });
        })

        socket.on('is_online_processed', (roomId) => {
            Rooms.findById(roomId)
                .then((docs) => {
                    // because this handles events from client so the reciever is automatically the therapist
                    var reciever = docs.TherapistId;
                    Io.to(reciever).emit('isAlsoOnline', roomId);
                })
                .catch(err => {
                    if (err) console.log(err);
                })
        })

        const wentOffline = () => {

            // get all rooms that this person participates in
            Rooms.find({ ClientId: req.user._id })
            .then(async room_docs => {
                for (let index = 0; index < room_docs.length; index++) {
                    const room = room_docs[index];
                    socket.to(room.TherapistId).emit('wentOffline', room._id);
                }
            })
            .catch(err => {
                if (err) console.log(err);
            })

        }

        // this code alerts all users that this person has gone offline
        socket.on('disconnect', wentOffline);
        
        // i kill the listener so for every new connection its a new listener
        Io.removeAllListeners("connection");
    
    });

    // retrieve all the rooms the current user is in
    if (req.user.isClient) {
        Rooms.find({ ClientId: req.user._id })
        .then(async rooms => {

            const loop = async _ => {

                for (let index = 0; index < rooms.length; index++) {
                    const room = rooms[index];

                    await Chats.find({ RoomId: room._id }).limit(15)
                        .then(chats => {
                            rooms[index].Chats = chats; 
                        })
                        .catch(err => {
                            if (err) console.log(err);
                        })

                    await Users.findOne({ _id: room.TherapistId })
                        .then(async user => {

                            await Therapists.findOne({ Email: user.Email })
                                .then(therapist => {
                                    rooms[index].Username = therapist.First_Name + ' ' + therapist.Last_Name;
                                    rooms[index].Sex = user.Sex;
                                    rooms[index].Display_Picture = user.Display_Picture;

                                })
                                .catch(err => {
                                    if (err) console.log(err);
                                })

                        })
                        .catch(err => {
                            if (err) console.log(err);
                        })
                    
                }

            }

            // Start the function and waits till everything finishes
            await loop();

            // get the user's record from database and send to the frontend useful in the chat page for the profile nav
            await Users.findById(req.user._id)
                .then(async users_docs => {

                    await Clients.findOne({ Email: users_docs.Email })
                        .then(docs => {
                            req.user.details = docs;
                        })
                        .catch(err => {
                            if (err) console.log(err);
                        })

                    })
                .catch(err => {
                    if (err) console.log(err)
                })

            res.render('rooms', {rooms_info: rooms, userStatus: req.user, user: req.user._id});

        })
        .catch(err => {
            res.send(err)
        })
    } else {
        req.errorMessage = "Unauthorized access to the requested page. <br> If you believe this to be an error please file a report on the contact us page."
        res.redirect(307, '/');
    }
    
});

// This makes sure all normal routes called from the client route c/ will redirect backwards
Router.get('/', (req, res) => {

    res.redirect('../');

})

Router.get('/index', (req, res) => {

    res.redirect('../index');

})

Router.get('/about', (req, res) => {

    res.redirect('../about');

})

Router.get('/contact', (req, res) => {

    res.redirect('../contact');

})

Router.get('/services', (req, res) => {

    res.redirect('../services');

})

module.exports = Router;