var app = require('express')();
var server = require('http').Server(app);
var io = require('socket.io')(server);
var fs = require('fs');

server.listen(3000);

var THREE = require('three');

var rooms = {};
var player2room = {};
var player2object = {};

function makePlatform( jsonUrl, scene, objects ) {

    var placeholder = new THREE.Object3D();

    var loader = new THREE.JSONLoader();

    var contents = fs.readFileSync(jsonUrl);
    var jsonContent = JSON.parse(contents);

    var model = loader.parse( jsonContent );
    
    model.geometry.computeFaceNormals();

    var platform = new THREE.Mesh( model.geometry );

    platform.name = 'platform';
    objects.push(platform);

    placeholder.add(platform);

    var scale = 10;
    placeholder.scale.x = scale;
    placeholder.scale.y = scale;
    placeholder.scale.z = scale;

    scene.add(placeholder);
}

function initMap(gameRoom) {
    makePlatform('model/platform.json',
        rooms[gameRoom].scene,
        rooms[gameRoom].objects);
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
        objects: [],
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
    rooms[gameRoom].objects.push(object);
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
        rooms[room_id].objects.remove(player2object[socketID]);
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
        delete rooms[roomID].objects;
        delete rooms[roomID];
    }
}

function quitPlayer(socketID) {
    removePlayer(socketID);
}

function updatePos(socketID, status, position, rotation) {
    if(typeof player2room[socketID] == 'undefined') return;
    var room = rooms[player2room[socketID]];
    room.players[socketID].position = position;
    room.players[socketID].rotation = rotation;
    room.players[socketID].status = status;
    player2object[socketID].position.set(position.x, position.y + OFFSET, position.z);
    player2object[socketID].rotation.set(rotation._x, rotation._y, rotation._z);
}

function updateShoot(socketID, position, direction) {
    var room = rooms[player2room[socketID]];
    var objects = room.objects;
    var pos = new THREE.Vector3(position.x, position.y, position.z);
    var dir = new THREE.Vector3(direction.x, direction.y, direction.z);
    dir.normalize();
    objects.forEach(function (mesh) {
        mesh.updateMatrixWorld();
    });
    rayCaster.set(pos, dir);
    
    var intersects = rayCaster.intersectObjects(objects);
    var shootID = -1;
    var ret = INFINITY;
    for(var i = 0; i < intersects.length; i ++) {
        if(intersects[i].object.name == 'platform' ||
            intersects[i].object.name == socketID) continue;
        shootID = intersects[i].object.name;
        if(room.players[shootID].deadtime > 0) {
            shootID = -1;
            continue;
        }
        ret = intersects[i].distance;
        break;
    }
    console.log(shootID);
    if(shootID != -1) {
        if(room.players[shootID].strongtime <= 0) {
            room.players[shootID].hp -= getNormalAttack();
        }
        if(room.players[shootID].hp <= 0) {
            room.players[socketID].kills ++;
            room.players[socketID].hp += killBonus;
            if(room.players[socketID].hp > maxLife) {
                room.players[socketID].hp = maxLife;
            }
            
            var playerID = room.players[shootID].id;
            room.players[shootID] = getNewPlayer(playerID);
            room.players[shootID].deadtime = DEADTIME;
            updatePos(shootID, STOP, room.players[shootID].position, room.players[shootID].rotation);
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
        status: STOP,
        deadtime: 0,
        strongtime: STRONGTIME,
        position: bornPlace[0].position,
        rotation: bornPlace[0].rotation
    };
}

function getObject3d(position, rotation) {

    var object = new THREE.Mesh(geometry);
    object.position.set(position.x, position.y, position.z);
    object.rotation.set(rotation._x, rotation._y, rotation._z);
    return object;
}

function getNormalAttack() {
    return normalAttack + getRandom(-randomRange, randomRange);
}

setInterval(function () {
    for(var room_id in rooms) {
        var room = rooms[room_id];
        if(room.curNum > 0) {
            for(var socketID in room.players) {
                var player = room.players[socketID];
                if(player.deadtime > 0) {
                    player.deadtime -= 100;
                } else if(player.strongtime > 0) {
                    player.strongtime -= 100;
                }
            }
            io.to('room-' + room_id).emit('syn-pos', room.players);
        }
    }
}, 100);

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

    socket.on('report-pos', function (socketID, status, position, rotation) {
        console.log('report pos: ' + socketID);
        updatePos(socketID, status, position, rotation);
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
var geometry = new THREE.BoxBufferGeometry(6, 6, 20.5);
var rayCaster = new THREE.Raycaster();

module.exports = app;

// player status
var STOP = 1;
var RUN = 2;
var DEADTIME = 5000; // ms
var STRONGTIME = 1000; // ms
var OFFSET = 10.25;
var INFINITY = 1000;

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