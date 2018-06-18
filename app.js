var app = require('express')();
var server = require('http').Server(app);
var io = require('socket.io')(server);
var fs = require('fs');
var mysql = require('mysql');

server.listen(3000);

/*
var connection = mysql.createConnection({
    host     : '127.0.0.1',
    user     : 'root',
    password : 'root',
    database : 'secure_chat'
});
connection.connect();
*/

var THREE = require('three');

var rooms = {};
var player2room = {};
var player2object = {};

function makePlatform( jsonUrl, scene ) {

    var loader = new THREE.JSONLoader();

    var contents = fs.readFileSync(jsonUrl);
    var jsonContent = JSON.parse(contents);

    var model = loader.parse( jsonContent );

    model.geometry.computeFaceNormals();

    var platform = new THREE.Mesh( model.geometry );

    platform.scale.x = 10;
    platform.scale.y = 10;
    platform.scale.z = 10;
    
    platform.name = 'platform';

    scene.add(platform);
}

function makeCureCylinder() {
    var cure = new THREE.Mesh(cureGeometry);
    cure.name = 'cure';
    cure.position.set(0, 50, 0);
    return cure;
}

function initMap(gameRoom) {
    makePlatform('model/platform.json',
        rooms[gameRoom].scene);
    rooms[gameRoom].scene.add(makeCureCylinder());
}

function getRandom(low, high) {
    var range = high - low;
    var rand = Math.random();
    return(low + Math.round(rand * range));
}

function initRoom(gameRoom) {
    rooms[gameRoom] = {
        players: {},
        curNum: 0,
        scene: new THREE.Scene()
    };
    initMap(gameRoom);
}

function initPlayer(gameRoom, socketID) {
    var player = rooms[gameRoom].players[socketID];
    var object = getObject3d(player.position, player.rotation);
    object.name = socketID;
    player2object[socketID] = object;
    player2room[socketID] = gameRoom;
    rooms[gameRoom].scene.add(object);
    rooms[gameRoom].curNum ++;
}

function addPlayer(socket, socketID, playerID, gameRoom) {
    console.log("new player enter the room: " + playerID);

    if(typeof rooms[gameRoom] == 'undefined') {
        initRoom(gameRoom);
    }

    if(typeof rooms[gameRoom].players[socketID] != 'undefined') {
        quitPlayer(socketID);
    }

    if(rooms[gameRoom].curNum >= maxPlayer) {
        return "房间已满"
    }

    rooms[gameRoom].players[socketID] = getNewPlayer(playerID);


    initPlayer(gameRoom, socketID);
    
    socket.join('room-' + gameRoom);

    return "添加成功";
}

function removePlayer(socketID) {
    var room_id = player2room[socketID];
    
    if(typeof room_id != 'undefined') {
        delete rooms[room_id].players[socketID];
        delete player2room[socketID];
        rooms[room_id].scene.remove(player2object[socketID]);
        delete player2object[socketID];
        rooms[room_id].curNum --;
    } else {
        room_id = -1;
    }
    return room_id;
}

function removeRoom(roomID) {
    if(typeof rooms[roomID] != 'undefined') {
        delete rooms[roomID].scene;
        delete rooms[roomID];
    }
}

function writeData(socketID, player) {
    /*
    connection.query('SELECT * FROM users', function (error, results, fields) {
        if (error) throw error;
        console.log('The solution is: ', results[0]);
    });
    */
}

function quitPlayer(socketID) {
    var room_id = player2room[socketID];
    if(typeof room_id != 'undefined') {
        var player = rooms[room_id].players[socketID];
        writeData(socketID, player);
    }
    removePlayer(socketID);
}

function updatePos(socketID, position, rotation) {
    if(typeof player2room[socketID] == 'undefined') return;
    var room = rooms[player2room[socketID]];
    if(position.y <= DEADLINE) {
        if(room.players[socketID].deadtime > 0 || room.players[socketID].strongtime > 0) return;
        room.players[socketID].deadtime = DEADTIME;
        return;
    }
    room.players[socketID].position = position;
    room.players[socketID].rotation = rotation;
    player2object[socketID].position.set(position.x, position.y + OFFSET, position.z);
    player2object[socketID].rotation.set(rotation._x, rotation._y, rotation._z);
}

function updateStatus(socketID, run_forward,
                      run_backward, run_left, run_right,
                      jump_forward, jump_backward,
                      fire, reload, die) {
    if(typeof player2room[socketID] == 'undefined') return;
    var room = rooms[player2room[socketID]];

    room.players[socketID].playing_run_forward = run_forward;
    room.players[socketID].playing_run_backward = run_backward;
    room.players[socketID].playing_run_left = run_left;
    room.players[socketID].playing_run_right = run_right;
    room.players[socketID].playing_jump_forward = jump_forward;
    room.players[socketID].playing_jump_backward = jump_backward;
    room.players[socketID].playing_fire = fire;
    room.players[socketID].playing_reload = reload;
    room.players[socketID].playing_die = die;
}

function updateShoot(socketID, position, direction) {
    var room = rooms[player2room[socketID]];
    var scene = room.scene;
    var pos = new THREE.Vector3(position.x, position.y, position.z);
    var dir = new THREE.Vector3(direction.x, direction.y, direction.z);
    dir.normalize();
    scene.children.forEach(function (mesh) {
        mesh.updateMatrixWorld();
    });
    rayCaster.set(pos, dir);
    
    var intersects = rayCaster.intersectObjects(scene.children);
    var shootID = -1;
    var ret = INFINITY;
    var point;
    for(var i = 0; i < intersects.length; i ++) {
        if(intersects[i].object.name == socketID) continue;
        shootID = intersects[i].object.name;
        if(shootID == 'platform' || shootID == 'cure') {
            ret = intersects[i].distance;
            shootID = -1;
            break;
        }
        if(room.players[shootID].deadtime > 0) {
            shootID = -1;
            continue;
        }
        point = intersects[i].point;
        ret = intersects[i].distance;
        break;
    }
    console.log(shootID);
    if(shootID != -1) {
        if(room.players[shootID].strongtime <= 0) {
            room.players[shootID].hp -= getNormalAttack();
            if(point.y - room.players[shootID].position.y >= BODYSIZE) {
                console.log('head shoot');
                room.players[shootID].hp -= getNormalAttack();
            }
        }
        if(room.players[shootID].hp <= 0) {
            room.players[socketID].kills ++;
            room.players[socketID].hp += killBonus;
            if(room.players[socketID].hp > maxLife) {
                room.players[socketID].hp = maxLife;
            }
            
            room.players[shootID].deadtime = DEADTIME;
        }
    }
    return ret;
}

function addRoom(gameRoom) {
    console.log("add room: " + gameRoom);
    
    if(typeof rooms[gameRoom] == 'undefined') {
        initRoom(gameRoom);
        return "添加成功";
    }

    return "房间已存在";
}

function getNewPlayer(playerID) {
    return {
        id: playerID,
        hp: maxLife,
        kills: 0,
        deadtime: 0,
        strongtime: STRONGTIME,
        position: bornPlace[0].position,
        rotation: bornPlace[0].rotation,
        cure: false,

        playing_run_forward: false,
        playing_run_backward: false,
        playing_run_left: false,
        playing_run_right: false,
        playing_jump_forward: false,
        playing_jump_backward: false,
        playing_fire: false,
        playing_reload: false,
        playing_die: false
    };
}

function getObject3d(position, rotation) {

    var object = new THREE.Mesh(geometry);
    object.position.set(position.x, position.y + OFFSET, position.z);
    object.rotation.set(rotation._x, rotation._y, rotation._z);
    return object;
}

function getNormalAttack() {
    return normalAttack + getRandom(-randomRange, randomRange);
}

function getCureD(position) {
    return position.x * position.x + position.y * position.y < CURERADIUS * CURERADIUS;
}

setInterval(function () {
    for(var room_id in rooms) {
        var room = rooms[room_id];
        if(room.curNum > 0) {
            for(var socketID in room.players) {
                var player = room.players[socketID];
                if(player.deadtime > 0) {
                    console.log(player.deadtime);
                    player.deadtime -= 50;
                    if(player.deadtime <= 0) {
                        room.players[socketID] = getNewPlayer(player.id);
                        player = room.players[socketID];
                        updatePos(socketID, player.position, player.rotation);
                    }
                } else if(player.strongtime > 0) {
                    player.strongtime -= 50;
                }
                if(player.deadtime <= 0 && getCureD(player.position)) {
                    player.hp += HPPS / 20;
                    if(player.hp > maxLife) player.hp = maxLife;
                    player.cure = true;
                } else {
                    player.cure = false;
                }
            }
            io.to('room-' + room_id).emit('syn-pos', room.players);
        }
    }
}, 50);

io.on('connection', function (socket) {
    console.log("new connection from: " + socket.id);
    
    socket.on('new-player', function (socketID, player_id, room_id) {
        var ret = addPlayer(socket, socketID, player_id, room_id);
        socket.emit('new-player-result', ret);
        if(ret == '添加成功') {
            console.log('look ' + socketID);
            io.to('room-' + room_id).emit('new-comer', socketID);
            for(var id in rooms[room_id].players) {
                if(id != socketID) socket.emit('new-comer', id);
            }
        }
    });

    socket.on('new-room', function (room_id) {
        var ret = addRoom(room_id);
        socket.emit('new-room-result', ret);
    });

    socket.on('remove-room', function (room_id) {
        if(rooms[room_id].curNum <= 0) removeRoom(room_id);
    });

    /*
     socket.on('disconnect', function () {
     console.log('quit before: ' + socket.id);
     var room_id = removePlayer(socket.id);
     if(room_id != -1) {
     console.log('quit room: ' + room_id);
     io.to('room-' + room_id).emit('quit-player', socket.id);
     }
     });
     */

    socket.on('report-pos', function (socketID, run_forward,
        run_backward, run_left, run_right,
        jump_forward, jump_backward,
        fire, reload, die, position, rotation) {
        updatePos(socketID, position, rotation);
        updateStatus(socketID, run_forward,
            run_backward, run_left, run_right,
            jump_forward, jump_backward,
            fire, reload, die);
    });

    socket.on('report-shoot', function (socketID, position, direction) {
        var ret = updateShoot(socketID, position, direction);
        var room_id = player2room[socketID];
        if(typeof room_id != 'undefined') {
            io.to('room-' + room_id).emit('shoot-result', position, direction, ret);
        }
    });
    
    socket.on('chat-message', function (socketID, msg) {
        var room_id = player2room[socketID];
        console.log("chat message: " + socketID + msg);
        if(typeof room_id != 'undefined') {
            io.to('room-' + room_id).emit('new-message', rooms[room_id].players[socketID].id, msg);
        }
    });
});

// game configure
var maxPlayer = 8;
var maxLife = 100;
var killBonus = 30;
var bornPlace = [new THREE.Object3D(), new THREE.Object3D()];
var normalAttack = 20;
var randomRange = 3;
var geometry = new THREE.BoxBufferGeometry(6, 20.5, 6);
var cureGeometry = new THREE.CylinderBufferGeometry(20, 20, 100, 16);
var rayCaster = new THREE.Raycaster();

module.exports = app;

// player status
var DEADTIME = 3000; // ms
var STRONGTIME = 1000; // ms
var OFFSET = 10.25;
var INFINITY = 1000;
var BODYSIZE = 18;
var CURERADIUS = 50;
var HPPS = 10;
var DEADLINE = -500;

Array.prototype.contains = function (val) {
    for (i in this) {
        if (this[i] == val) return true;
    }
    return false;
};
Array.prototype.indexOf = function(val) {
    for (var i = 0; i < this.length; i++) {
        if (this[i] == val) return i;
    }
    return -1;
};
Array.prototype.remove = function(val) {
    var index = this.indexOf(val);
    if (index > -1) {
        this.splice(index, 1);
    }
};