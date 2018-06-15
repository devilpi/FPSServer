var app = require('express')();
var server = require('http').Server(app);
var io = require('socket.io')(server);
var fs = require('fs');

server.listen(3000);

var THREE = require('three');

var rooms = [];
var player2room = [];
var player2object = [];

function makePlatform( jsonUrl ) {

    var loader = new THREE.JSONLoader();

    var contents = fs.readFileSync(jsonUrl);
    var jsonContent = JSON.parse(contents);

    var model = loader.parse( jsonContent );
    
    model.geometry.computeFaceNormals();

    var platform = new THREE.Mesh( model.geometry );

    platform.name = 'platform';

    return platform;
}

function initMap() {
    var scene = new THREE.Scene();
    scene.add( makePlatform(
        'model/platform.json'
    ));
    return scene;
}

function getRandom(low, high) {
    var range = high - low;
    var rand = Math.random();
    return(low + Math.round(rand * range));
}

function initRoom(gameRoom) {
    rooms[gameRoom] = {
        players: [],
        curNum: 0,
        scene: initMap()
    };
}

function initPlayer(gameRoom, socketID) {
    var player = rooms[gameRoom].players[socketID];
    var object = getObject3d(player.position, player.rotation);
    object.name = socketID;
    player2object[socketID] = object;
    player2room[socketID] = gameRoom;
    rooms[gameRoom].scene.add(object);
}

function addPlayer(socket, playerID, gameRoom) {
    console.log("new player enter the room: " + playerID);

    if(typeof rooms[gameRoom] == 'undefined') {
        initRoom(gameRoom);
    }

    if(typeof rooms[gameRoom].players[socket.id] != 'undefined') {
        return "玩家已存在";
    }

    if(rooms[gameRoom].curNum >= maxPlayer) {
        return "房间已满"
    }

    rooms[gameRoom].players[socket.id] = {
        id: playerID,
        hp: maxLife,
        kills: 0,
        status: STOP,
        deadtime: 0,
        strongtime: STRONGTIME,
        position: bornPlace[0].position,
        rotation: bornPlace[0].rotation
    };

    initPlayer(gameRoom, socket.id);
    
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
        player2room.forEach(function (room_id, socketID) {
            if(room_id == roomID) {
                removePlayer(socketID);
            }
        });
        delete rooms[roomID].scene;
        delete rooms[roomID];
    }
}

function updatePos(socketID, status, position, rotation) {
    var room = rooms[player2room[socketID]];
    room.players[socketID].position = position;
    room.players[socketID].rotation = rotation;
    room.players[socketID].status = status;
    player2object[socketID].position.set(position.x, position.y, position.z);
    player2object[socketID].rotation.set(rotation._x, rotation._y, rotation._z);
}

function updateShoot(socket, position, direction) {
    var room = rooms[player2room[socket.id]];
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
    for(var i = 0; i < intersects.length; i ++) {
        if(intersects[i].object.name == 'platform' ||
            intersects[i].object.name == socket.id) continue;
        shootID = intersects[i].object.name;
        if(room.players[shootID].deadtime > 0) {
            shootID = -1;
            continue;
        }
        break;
    }
    console.log(shootID);
    if(shootID != -1) {
        if(room.players[shootID].strongtime <= 0) {
            room.players[shootID].hp -= getNormalAttack();
        }
        if(room.players[shootID].hp <= 0) {
            room.players[socket.id].kills ++;
            room.players[socket.id].hp += killBonus;
            if(room.players[socket.id].hp > maxLife) {
                room.players[socket.id].hp = maxLife;
            }
            
            var playerID = room.players[shootID].id;
            room.players[shootID] = {
                id: playerID,
                hp: maxLife,
                kills: 0,
                status: STOP,
                deadtime: DEADTIME,
                strongtime: STRONGTIME,
                position: bornPlace[0].position,
                rotation: bornPlace[0].rotation
            };
            updatePos(shootID, STOP, room.players[shootID].position, room.players[shootID].rotation);
        }
    }
}

function addRoom(gameRoom) {
    console.log("add room: " + gameRoom);
    
    if(typeof rooms[gameRoom] == 'undefined') {
        initRoom(gameRoom);
        return "添加成功";
    }

    return "房间已存在";
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
    rooms.forEach(function (room, room_id) {
        room.players.forEach(function (player) {
            if(player.deadtime > 0) {
                player.deadtime -= 100;
            } else if(player.strongtime > 0) {
                player.strongtime -= 100;
            }
        });
        if(room.curNum > 0) {
            io.to('room-' + room_id).emit('syn-pos', room.players);
        }
    });
}, 100);

io.on('connection', function (socket) {
    console.log("new connection from: " + socket.id);
    
    socket.on('new-player', function (player_id, room_id) {
        var ret = addPlayer(socket, player_id, room_id);
        socket.emit('new-player-result', ret);
        if(ret == '添加成功') {
            io.to('room-' + room_id).emit('new-comer', player_id);
        }
    });
    
    socket.on('new-room', function (room_id) {
        var ret = addRoom(room_id);
        socket.emit('new-room-result', ret);
    });

    socket.on('remove-room', function (room_id) {
        removeRoom(room_id);
    });
    
    socket.on('disconnect', function () {
        console.log('quit before: ' + socket.id);
        var room_id = removePlayer(socket.id);
        if(room_id != -1) {
            console.log('quit room: ' + room_id);
            io.to('room-' + room_id).emit('quit-player', socket.id);
        }
    });

    socket.on('report-pos', function (status, position, rotation) {
        console.log('report pos: ' + socket.id);
        updatePos(socket.id, status, position, rotation);
    });

    socket.on('report-shoot', function (position, direction) {
        updateShoot(socket, position, direction);
    });
});

// game configure
var maxPlayer = 8;
var maxLife = 100;
var killBonus = 30;
var bornPlace = [new THREE.Object3D(), new THREE.Object3D()];
var normalAttack = 20;
var randomRange = 3;
var geometry = new THREE.BoxBufferGeometry(10, 10, 10);
var rayCaster = new THREE.Raycaster();

module.exports = app;

// player status
var STOP = 1;
var RUN = 2;
var DEADTIME = 5000; // ms
var STRONGTIME = 1000; // ms